import { AppError } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { validationFailed } from '@/lib/api/errors';
import { requireAuth } from '@/lib/auth/context';
import { guardrailWarnings, qualifyAndStore } from '@/lib/ai/lead-qualification';
import { idSchema } from '@/lib/validation/common';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ leadId: idSchema });

/**
 * Scores a lead on demand.
 *
 * Leads are qualified automatically on capture; this is the re-run, for after an
 * owner has added detail from a phone call. Rate-limited on its own budget
 * because every call costs tokens.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.ai, auth.organization.id);

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const outcome = await qualifyAndStore(auth, parsed.data.leadId, {
    actorUserId: auth.user.id,
  });

  if (!outcome.ok) {
    // Mapped to real status codes so a client can tell "you cannot do this" from
    // "this went wrong": 403 for a spent allowance, 501 for a deployment with no
    // AI configured at all, 502 for an upstream failure.
    const code =
      outcome.reason === 'limit'
        ? 'forbidden'
        : outcome.reason === 'unavailable'
          ? 'not_implemented'
          : 'bad_gateway';

    throw new AppError(code, outcome.message);
  }

  return jsonOk({
    qualification: {
      score: outcome.result.score,
      summary: outcome.result.summary,
      intent: outcome.result.intent,
      urgency: outcome.result.urgency,
      recommendedAction: outcome.result.recommendedAction,
      suggestedResponse: outcome.result.suggestedResponse,
    },
    warnings: guardrailWarnings(outcome.result),
  });
});
