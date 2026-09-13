import { UsageMetric } from '@prisma/client';

import { AiFailureError, AiUnavailableError, aiEnabled } from '@/lib/ai/client';
import { describeFinding } from '@/lib/ai/guardrails';
import { qualifyLead, type QualificationResult } from '@/lib/ai/qualify';
import { effectivePlan, enforceUsageLimit, recordUsage } from '@/lib/billing/usage';
import type { AuthContext } from '@/lib/auth/context';
import { logActivity } from '@/lib/leads/repository';

/**
 * Qualifying a lead and storing the result.
 *
 * The one rule this module exists to enforce: **capturing a lead must never
 * depend on the AI working.** A missed enquiry is the failure the whole product
 * is sold to prevent, so if OpenAI is unconfigured, rate-limited, slow or down,
 * the lead is still saved and still worked — it simply has no score yet.
 */

export type QualifyOutcome =
  | { ok: true; result: QualificationResult }
  | { ok: false; reason: 'unavailable' | 'limit' | 'failed'; message: string };

/**
 * Runs qualification for one lead and writes the result onto it.
 *
 * Returns an outcome rather than throwing for the expected failures, because
 * every caller — a route handler wanting a status code, or a fire-and-forget
 * background call that must swallow everything — needs to distinguish "this
 * workspace has no AI" from "the model is broken".
 */
export async function qualifyAndStore(
  auth: AuthContext,
  leadId: string,
  options: { actorUserId?: string | null } = {},
): Promise<QualifyOutcome> {
  if (!aiEnabled()) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'AI is not configured for this deployment.',
    };
  }

  const lead = await auth.db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      serviceRequested: true,
      description: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      source: true,
      estimatedValueCents: true,
    },
  });

  // Not an error worth shouting about: a lead can be deleted between the
  // creation that scheduled this and the moment it runs.
  if (!lead) {
    return { ok: false, reason: 'failed', message: 'That lead no longer exists.' };
  }

  const plan = effectivePlan(auth.subscription);

  try {
    await enforceUsageLimit(auth.db, plan, UsageMetric.AI_CALLS);
  } catch (error) {
    return {
      ok: false,
      reason: 'limit',
      message: error instanceof Error ? error.message : 'AI usage limit reached.',
    };
  }

  let result: QualificationResult;
  try {
    result = await qualifyLead(lead, {
      name: auth.organization.name,
      industry: auth.organization.industry,
      currency: auth.organization.currency,
    });
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      return { ok: false, reason: 'unavailable', message: error.message };
    }

    // Logged with detail, reported without it. The upstream message can name an
    // invalid key or a billing problem, which belongs in our logs and nowhere
    // near a customer's screen.
    console.error('[ai] lead qualification failed', { leadId, error });

    return {
      ok: false,
      reason: 'failed',
      message:
        error instanceof AiFailureError
          ? 'The AI service could not be reached. The lead is saved — try again shortly.'
          : 'Could not qualify that lead.',
    };
  }

  // Metered on a completed call, so a timeout does not spend someone's
  // allowance on nothing.
  await recordUsage(auth.db, auth.organization.id, UsageMetric.AI_CALLS);

  await auth.db.lead.update({
    where: { id: leadId },
    data: {
      aiScore: result.score,
      aiSummary: result.summary,
      aiIntent: result.intent,
      aiUrgency: result.urgency,
      aiRecommendedAction: result.recommendedAction,
      aiSuggestedResponse: result.suggestedResponse,
      aiQualifiedAt: new Date(),
      aiModel: result.model,
    },
  });

  await logActivity(auth.db, auth.organization.id, {
    leadId,
    type: 'ai_qualified',
    summary:
      result.score === null
        ? 'Qualified by AI'
        : `Qualified by AI — scored ${result.score}/100, ${result.urgency.toLowerCase()} urgency`,
    detail: {
      score: result.score,
      urgency: result.urgency,
      model: result.model,
      // Recorded so an owner can see later *that* something was removed from a
      // draft, not only that a draft exists.
      guardrails: result.findings.map((finding) => finding.rule),
    },
    // Null when this ran automatically on capture — the timeline should not
    // credit a person with something a background call did.
    actorUserId: options.actorUserId ?? null,
  });

  return { ok: true, result };
}

/**
 * Fire-and-forget qualification, for the moment a lead is created.
 *
 * Deliberately not awaited by the caller. Lead creation returns as soon as the
 * row is written; the score arrives a second or two later. Making the owner's
 * "Add lead" button wait on a third-party round trip would be the wrong trade in
 * both directions — slower when it works, broken when it does not.
 */
export function qualifyInBackground(auth: AuthContext, leadId: string): void {
  if (!aiEnabled()) return;

  void qualifyAndStore(auth, leadId).catch((error: unknown) => {
    console.error('[ai] background qualification threw', { leadId, error });
  });
}

/** The owner-facing warnings for whatever the guardrails removed. */
export function guardrailWarnings(result: QualificationResult): string[] {
  const seen = new Set<string>();

  for (const finding of result.findings) {
    seen.add(describeFinding(finding.rule));
  }

  return [...seen];
}
