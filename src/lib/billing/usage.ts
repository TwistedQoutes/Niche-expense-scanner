import { PlanTier, SubscriptionStatus, UsageMetric } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import { limitFor, planFor } from '@/lib/billing/plans';
import { currentUsagePeriod } from '@/lib/dates';
import type { TenantClient } from '@/lib/db/tenant';

/**
 * Metered usage and plan limits.
 *
 * Counters are per organization, per metric, per calendar month, and they are
 * counters rather than `SELECT count(*)`. That distinction matters: a FREE plan
 * allows five leads *per month*, and counting rows answers a different question
 * the moment a lead is deleted — delete five, add five more, and the limit has
 * quietly become "five at a time" instead of "five a month".
 *
 * The month is the row key, so a period rolls over on its own with no scheduled
 * job to forget to run.
 */

export type UsageState = {
  metric: UsageMetric;
  used: number;
  /** null means unlimited. */
  limit: number | null;
  remaining: number | null;
  exceeded: boolean;
};

/**
 * Which plan's limits apply right now.
 *
 * A trialing workspace gets the plan it is trialing. A past-due or cancelled
 * one falls back to FREE rather than losing access outright: locking someone
 * out of their own customer list over a failed card is how you turn a billing
 * problem into a cancellation. They keep their data and hit the free ceiling.
 */
export function effectivePlan(
  subscription: { plan: PlanTier; status: SubscriptionStatus; trialEndsAt: Date | null } | null,
  now: Date = new Date(),
): PlanTier {
  if (!subscription) return PlanTier.FREE;

  if (subscription.status === SubscriptionStatus.TRIALING) {
    const trialOver = subscription.trialEndsAt !== null && subscription.trialEndsAt <= now;
    return trialOver ? PlanTier.FREE : subscription.plan;
  }

  if (subscription.status === SubscriptionStatus.ACTIVE) return subscription.plan;

  return PlanTier.FREE;
}

export async function readUsage(
  db: TenantClient,
  plan: PlanTier,
  metric: UsageMetric,
): Promise<UsageState> {
  const period = currentUsagePeriod();

  const row = await db.usage.findFirst({
    where: { metric, period },
    select: { count: true },
  });

  const used = row?.count ?? 0;
  const limit = limitFor(plan, metric);

  return {
    metric,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    exceeded: limit !== null && used >= limit,
  };
}

/**
 * Records one unit of usage.
 *
 * An upsert on the unique (organization, metric, period) key, so two concurrent
 * requests cannot both read 4 and both write 5. The increment happens in the
 * database, not in application code.
 */
export async function recordUsage(
  db: TenantClient,
  organizationId: string,
  metric: UsageMetric,
  amount = 1,
): Promise<void> {
  const period = currentUsagePeriod();

  await db.usage.upsert({
    where: { organizationId_metric_period: { organizationId, metric, period } },
    create: { organizationId, metric, period, count: amount },
    update: { count: { increment: amount } },
  });
}

/**
 * Refuses the request when the plan's allowance for this month is spent.
 *
 * The message names the plan and the number rather than saying "limit
 * reached", because the owner's next question is always "how many do I get?"
 * and a vague error sends them to support instead of to the upgrade page.
 */
export async function enforceUsageLimit(
  db: TenantClient,
  plan: PlanTier,
  metric: UsageMetric,
): Promise<UsageState> {
  const state = await readUsage(db, plan, metric);

  if (state.exceeded) {
    const planName = planFor(plan).name;
    throw new AppError(
      'forbidden',
      `Your ${planName} plan includes ${state.limit} ${LABELS[metric]} a month and you have used them all. Upgrade to carry on.`,
    );
  }

  return state;
}

const LABELS: Record<UsageMetric, string> = {
  [UsageMetric.LEADS]: 'leads',
  [UsageMetric.QUOTES]: 'quotes',
  [UsageMetric.SMS_SENT]: 'text messages',
  [UsageMetric.EMAILS_SENT]: 'emails',
  [UsageMetric.AI_CALLS]: 'AI actions',
};
