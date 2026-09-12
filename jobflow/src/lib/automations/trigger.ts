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
 */
export async function fireTrigger(
  db: TenantClient,
  organizationId: string,
  trigger: AutomationTrigger,
  subject: AutomationSubject,
  options: { now?: Date } = {},
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
