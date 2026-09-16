import { AutomationRunStatus, AutomationTrigger } from '@prisma/client';

import type { TenantClient } from '@/lib/db/tenant';

/**
 * Starting and stopping automation runs.
 *
 * An `AutomationRun` is a queue row: "this automation, about this record, next
 * step due at this time". The worker picks up whatever is due. Keeping the
 * position in the row rather than in memory means a sequence survives a deploy,
 * a crash, and a cold serverless instance — which it has to, because the whole
 * point is that it runs on day 5 without anyone remembering.
 */

export type SubjectType = 'lead' | 'quote' | 'job' | 'customer';

/** What a run is about: one of the four subject kinds, plus its id. */
export type AutomationSubject = { type: SubjectType; id: string };

/**
 * Starts every enabled automation for a trigger.
 *
 * Idempotent per (automation, subject) thanks to a unique index, so firing the
 * same trigger twice — a webhook retried, a button double-clicked — does not
 * start two sequences that both text the customer.
 *
 * `rearmFinishedRuns` is for the triggers that are meant to happen again.
 * Reactivation is the case: a lawn customer needs chasing every season, and the
 * unique row outlives the run it created, so without this a customer could be
 * reactivated exactly once in the lifetime of the workspace. It re-arms a run
 * that has **finished** and never one still in flight — restarting a chase
 * already under way would text somebody twice.
 */
export async function fireTrigger(
  db: TenantClient,
  organizationId: string,
  trigger: AutomationTrigger,
  subject: AutomationSubject,
  options: { now?: Date; rearmFinishedRuns?: boolean } = {},
): Promise<number> {
  const now = options.now ?? new Date();

  const automations = await db.automation.findMany({
    where: { trigger, enabled: true },
    select: {
      id: true,
      steps: { orderBy: { position: 'asc' }, take: 1, select: { delayMinutes: true } },
    },
  });

  let started = 0;

  for (const automation of automations) {
    // An automation with no steps would create a run that can never advance.
    const first = automation.steps[0];
    if (!first) continue;

    const runAt = new Date(now.getTime() + first.delayMinutes * 60_000);

    try {
      await db.automationRun.create({
        data: {
          organizationId,
          automationId: automation.id,
          subjectType: subject.type,
          subjectId: subject.id,
          status: AutomationRunStatus.PENDING,
          currentStep: 0,
          runAt,
        },
      });
      started += 1;
    } catch (error) {
      // P2002 is the unique index on (automationId, subjectType, subjectId):
      // a run for this subject already exists, which is exactly the outcome we
      // want from a duplicate trigger.
      const isDuplicate =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
      if (!isDuplicate) throw error;

      if (!options.rearmFinishedRuns) continue;

      /*
       * The row is reused rather than a second one inserted, which keeps the
       * unique index — and therefore the idempotency above — intact. The cost is
       * that this chase replaces the previous one's bookkeeping; the messages
       * themselves stay in the conversation, which is the record of what the
       * customer actually received.
       *
       * Scoped to terminal statuses so a PENDING or RUNNING sequence is left
       * alone.
       */
      const rearmed = await db.automationRun.updateMany({
        where: {
          automationId: automation.id,
          subjectType: subject.type,
          subjectId: subject.id,
          status: {
            in: [
              AutomationRunStatus.COMPLETED,
              AutomationRunStatus.CANCELLED,
              AutomationRunStatus.FAILED,
            ],
          },
        },
        data: {
          status: AutomationRunStatus.PENDING,
          currentStep: 0,
          runAt,
          attempts: 0,
          lastError: null,
          startedAt: null,
          completedAt: null,
        },
      });

      if (rearmed.count > 0) started += 1;
    }
  }

  return started;
}

/**
 * Stops in-flight sequences about a subject.
 *
 * This is the single most important behaviour in the whole follow-up feature.
 * The customer replying, accepting, or declining must silence the chase
 * immediately — nothing makes a business look less attentive than "just checking
 * in about your quote" arriving three days after the customer already said yes.
 *
 * Cancelled rather than deleted, so the history of what was sent survives.
 */
export async function cancelRuns(
  db: TenantClient,
  subject: AutomationSubject,
  options: { reason?: string } = {},
): Promise<number> {
  const { count } = await db.automationRun.updateMany({
    where: {
      subjectType: subject.type,
      subjectId: subject.id,
      status: { in: [AutomationRunStatus.PENDING, AutomationRunStatus.RUNNING] },
    },
    data: {
      status: AutomationRunStatus.CANCELLED,
      completedAt: new Date(),
      lastError: options.reason ?? null,
    },
  });

  return count;
}

/**
 * Cancels every sequence aimed at somebody who is still a lead.
 *
 * The lead's own runs are the obvious half. The other half is the quote they
 * were sent: a quote raised against a lead carries a three-touch follow-up whose
 * subject is the *quote*, so cancelling by lead id alone leaves it running — and
 * the person who has just replied "yes please" gets "just checking in" two days
 * later. The customer version below has always swept across subjects; this is the
 * same rule for the half of the pipeline where the person has not been converted
 * yet.
 */
export async function cancelRunsForLead(
  db: TenantClient,
  leadId: string,
  options: { reason?: string } = {},
): Promise<number> {
  const quotes = await db.quote.findMany({ where: { leadId }, select: { id: true } });

  const subjects: { type: SubjectType; id: string }[] = [
    { type: 'lead', id: leadId },
    ...quotes.map((row) => ({ type: 'quote' as const, id: row.id })),
  ];

  let cancelled = 0;
  for (const subject of subjects) {
    cancelled += await cancelRuns(db, subject, options);
  }

  return cancelled;
}

/**
 * Cancels every sequence aimed at a person, across subjects.
 *
 * A customer who replies to a quote follow-up has also, in effect, replied to the
 * reactivation nudge queued against their customer record. Chasing them on a
 * second track because the first one stopped would be worse than not stopping at
 * all — so a reply silences everything about them.
 */
export async function cancelRunsForCustomer(
  db: TenantClient,
  customerId: string,
  options: { reason?: string } = {},
): Promise<number> {
  const [leads, quotes, jobs] = await Promise.all([
    db.lead.findMany({ where: { customerId }, select: { id: true } }),
    db.quote.findMany({ where: { customerId }, select: { id: true } }),
    db.job.findMany({ where: { customerId }, select: { id: true } }),
  ]);

  const subjects: { type: SubjectType; id: string }[] = [
    { type: 'customer', id: customerId },
    ...leads.map((row) => ({ type: 'lead' as const, id: row.id })),
    ...quotes.map((row) => ({ type: 'quote' as const, id: row.id })),
    ...jobs.map((row) => ({ type: 'job' as const, id: row.id })),
  ];

  let cancelled = 0;
  for (const subject of subjects) {
    cancelled += await cancelRuns(db, subject, options);
  }

  return cancelled;
}
