import { OrganizationStatus, PlanTier, SubscriptionStatus } from '@prisma/client';

import { planFor, PLANS } from '@/lib/billing/plans';
import { effectivePlan } from '@/lib/billing/usage';
import { recentMonthKeys, type MonthKey } from '@/lib/dates';
import { prisma } from '@/lib/db/client';

/**
 * Platform-wide figures, for whoever runs JobFlow itself.
 *
 * Everything here reads across **every** workspace, which is precisely why it uses
 * the unscoped client and why the only door to it is `requirePlatformAdmin()`. A
 * tenant-scoped client would be the wrong tool — but that also means nothing in
 * this file may ever be rendered on a screen a customer can reach. It is imported
 * by `/admin` and nowhere else.
 *
 * Only aggregates and the operator's own administrative fields are returned. A
 * platform admin can see that a workspace exists, what it pays and whether it is
 * active; they get no route here to a business's leads, customers or messages.
 */

export type PlatformTotals = {
  organizations: number;
  activeOrganizations: number;
  demoOrganizations: number;
  users: number;
  /** Workspaces with a paying subscription right now. */
  paying: number;
  trialing: number;
  /** Monthly recurring revenue, in cents, from list prices. */
  mrrCents: number;
};

export type PlanBreakdownRow = {
  tier: PlanTier;
  name: string;
  monthlyPriceCents: number;
  workspaces: number;
  /** Of those, how many are actually paying rather than trialing or lapsed. */
  paying: number;
  mrrCents: number;
};

export type SignupPoint = { month: MonthKey; signups: number };

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  industry: string;
  status: OrganizationStatus;
  isDemo: boolean;
  createdAt: Date;
  plan: PlanTier;
  subscriptionStatus: SubscriptionStatus | null;
  effective: PlanTier;
  members: number;
  leads: number;
  jobs: number;
};

export type PlatformReport = {
  totals: PlatformTotals;
  plans: PlanBreakdownRow[];
  signups: SignupPoint[];
  workspaces: WorkspaceRow[];
};

/**
 * MRR from list prices, not from Stripe.
 *
 * Deliberate and worth being explicit about: this counts what the plans cost, so
 * a discount or a promotion code is not reflected. It is a health indicator, not
 * an accounting figure — Stripe is the authority on money, and a number in an
 * admin panel that looks like revenue but disagrees with the payment processor is
 * worse than no number.
 */
function mrrFor(tier: PlanTier, status: SubscriptionStatus | null): number {
  if (status !== SubscriptionStatus.ACTIVE) return 0;
  return planFor(tier).monthlyPriceCents;
}

export async function loadPlatformReport(
  options: { now?: Date; workspaceLimit?: number } = {},
): Promise<PlatformReport> {
  const now = options.now ?? new Date();
  const months = recentMonthKeys(12, now);

  const [organizations, userCount, subscriptions] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      take: options.workspaceLimit ?? 100,
      select: {
        id: true,
        name: true,
        slug: true,
        industry: true,
        status: true,
        isDemo: true,
        createdAt: true,
        subscription: { select: { plan: true, status: true, trialEndsAt: true } },
        _count: { select: { memberships: true, leads: true, jobs: true } },
      },
    }),
    prisma.user.count(),
    // Counted across every workspace, not just the page of them listed above —
    // otherwise the totals would silently mean "of the most recent hundred".
    prisma.subscription.findMany({ select: { plan: true, status: true, trialEndsAt: true } }),
  ]);

  const [organizationCount, activeCount, demoCount] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { status: OrganizationStatus.ACTIVE } }),
    prisma.organization.count({ where: { isDemo: true } }),
  ]);

  const signupRows = await prisma.organization.findMany({
    where: { createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)) } },
    select: { createdAt: true },
  });

  const signupBuckets = new Map(months.map((month) => [month, 0]));
  for (const row of signupRows) {
    const month = row.createdAt.toISOString().slice(0, 7);
    if (signupBuckets.has(month)) signupBuckets.set(month, signupBuckets.get(month)! + 1);
  }

  const byTier = new Map<PlanTier, { workspaces: number; paying: number; mrrCents: number }>(
    PLANS.map((plan) => [plan.tier, { workspaces: 0, paying: 0, mrrCents: 0 }]),
  );

  let paying = 0;
  let trialing = 0;
  let mrrCents = 0;

  for (const subscription of subscriptions) {
    const entry = byTier.get(subscription.plan);
    if (!entry) continue;

    entry.workspaces += 1;

    const amount = mrrFor(subscription.plan, subscription.status);
    if (amount > 0) {
      entry.paying += 1;
      entry.mrrCents += amount;
      paying += 1;
      mrrCents += amount;
    }

    if (subscription.status === SubscriptionStatus.TRIALING) trialing += 1;
  }

  return {
    totals: {
      organizations: organizationCount,
      activeOrganizations: activeCount,
      demoOrganizations: demoCount,
      users: userCount,
      paying,
      trialing,
      mrrCents,
    },
    plans: PLANS.map((plan) => ({
      tier: plan.tier,
      name: plan.name,
      monthlyPriceCents: plan.monthlyPriceCents,
      workspaces: byTier.get(plan.tier)?.workspaces ?? 0,
      paying: byTier.get(plan.tier)?.paying ?? 0,
      mrrCents: byTier.get(plan.tier)?.mrrCents ?? 0,
    })),
    signups: months.map((month) => ({ month, signups: signupBuckets.get(month) ?? 0 })),
    workspaces: organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      industry: organization.industry,
      status: organization.status,
      isDemo: organization.isDemo,
      createdAt: organization.createdAt,
      plan: organization.subscription?.plan ?? PlanTier.FREE,
      subscriptionStatus: organization.subscription?.status ?? null,
      effective: effectivePlan(organization.subscription ?? null, now),
      members: organization._count.memberships,
      leads: organization._count.leads,
      jobs: organization._count.jobs,
    })),
  };
}
