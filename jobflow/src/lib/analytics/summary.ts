import { JobStatus, LeadStatus, QuoteStatus } from '@prisma/client';

import type { TenantClient } from '@/lib/db/tenant';

/**
 * The dashboard's numbers.
 *
 * Two rules shape this module:
 *
 *  1. **One round trip.** Every figure is gathered in a single
 *     `Promise.all`, so the dashboard costs one burst of parallel queries
 *     rather than a waterfall. Rendering ten tiles sequentially is how a
 *     dashboard ends up taking four seconds on a phone with one bar of signal.
 *  2. **The tenant client does the scoping.** Nothing here mentions
 *     `organizationId`; the client it is handed has already been pinned to one
 *     (see src/lib/db/tenant.ts). That is what makes this module impossible to
 *     misuse across tenants.
 */

export type DashboardSummary = {
  leads: {
    total: number;
    new: number;
    qualified: number;
    deltaPercent: number | null;
  };
  quotes: {
    sent: number;
    accepted: number;
    acceptanceRatePercent: number;
    outstandingCount: number;
    outstandingCents: number;
    deltaPercent: number | null;
  };
  jobs: {
    scheduled: number;
    completed: number;
    deltaPercent: number | null;
  };
  revenue: {
    completedCents: number;
    deltaPercent: number | null;
  };
  conversionRatePercent: number;
  recentLeads: {
    id: string;
    name: string;
    serviceRequested: string | null;
    estimatedValueCents: number | null;
  }[];
  upcomingJobs: {
    id: string;
    title: string;
    customerName: string;
    priceCents: number;
  }[];
};

/** Quote states where the business is still waiting on the customer. */
const OUTSTANDING_QUOTE_STATES = [
  QuoteStatus.SENT,
  QuoteStatus.VIEWED,
  QuoteStatus.CHANGES_REQUESTED,
];

/**
 * Percentage change, or null when there is nothing to compare against.
 *
 * Returning null rather than 0 or 100 for "was zero, now five" matters: the
 * first month of every account has no previous period, and a tile reading
 * "+∞%" or a misleading "+0%" is worse than one that simply omits the delta.
 */
function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

export async function getDashboardSummary(db: TenantClient): Promise<DashboardSummary> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

  const thisMonth = { gte: monthStart };
  const lastMonth = { gte: previousMonthStart, lt: monthStart };

  const [
    leadsThisMonth,
    leadsLastMonth,
    leadsNew,
    leadsQualified,
    leadsWonThisMonth,
    quotesSentThisMonth,
    quotesSentLastMonth,
    quotesAcceptedThisMonth,
    outstandingQuotes,
    jobsScheduled,
    jobsCompletedThisMonth,
    jobsCompletedLastMonth,
    revenueThisMonth,
    revenueLastMonth,
    recentLeads,
    upcomingJobs,
  ] = await Promise.all([
    db.lead.count({ where: { createdAt: thisMonth } }),
    db.lead.count({ where: { createdAt: lastMonth } }),
    db.lead.count({ where: { status: LeadStatus.NEW } }),
    db.lead.count({ where: { status: LeadStatus.QUALIFIED } }),
    db.lead.count({ where: { status: LeadStatus.WON, closedAt: thisMonth } }),

    db.quote.count({ where: { sentAt: thisMonth } }),
    db.quote.count({ where: { sentAt: lastMonth } }),
    db.quote.count({ where: { status: QuoteStatus.ACCEPTED, respondedAt: thisMonth } }),
    db.quote.aggregate({
      where: { status: { in: OUTSTANDING_QUOTE_STATES } },
      _count: true,
      _sum: { totalCents: true },
    }),

    db.job.count({
      where: { status: { in: [JobStatus.SCHEDULED, JobStatus.CONFIRMED] } },
    }),
    db.job.count({ where: { status: JobStatus.COMPLETED, completedAt: thisMonth } }),
    db.job.count({ where: { status: JobStatus.COMPLETED, completedAt: lastMonth } }),

    // Revenue is recognised on completion, not on acceptance. An accepted quote
    // is a promise; a completed job is work that can be invoiced.
    db.job.aggregate({
      where: { status: JobStatus.COMPLETED, completedAt: thisMonth },
      _sum: { priceCents: true },
    }),
    db.job.aggregate({
      where: { status: JobStatus.COMPLETED, completedAt: lastMonth },
      _sum: { priceCents: true },
    }),

    db.lead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        serviceRequested: true,
        estimatedValueCents: true,
      },
    }),

    db.job.findMany({
      where: {
        status: { in: [JobStatus.SCHEDULED, JobStatus.CONFIRMED] },
        scheduledFor: { gte: now, lt: weekAhead },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 5,
      select: {
        id: true,
        title: true,
        priceCents: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const completedCents = revenueThisMonth._sum.priceCents ?? 0;
  const previousRevenueCents = revenueLastMonth._sum.priceCents ?? 0;

  return {
    leads: {
      total: leadsThisMonth,
      new: leadsNew,
      qualified: leadsQualified,
      deltaPercent: deltaPercent(leadsThisMonth, leadsLastMonth),
    },
    quotes: {
      sent: quotesSentThisMonth,
      accepted: quotesAcceptedThisMonth,
      acceptanceRatePercent: percent(quotesAcceptedThisMonth, quotesSentThisMonth),
      outstandingCount: outstandingQuotes._count,
      outstandingCents: outstandingQuotes._sum.totalCents ?? 0,
      deltaPercent: deltaPercent(quotesSentThisMonth, quotesSentLastMonth),
    },
    jobs: {
      scheduled: jobsScheduled,
      completed: jobsCompletedThisMonth,
      deltaPercent: deltaPercent(jobsCompletedThisMonth, jobsCompletedLastMonth),
    },
    revenue: {
      completedCents,
      deltaPercent: deltaPercent(completedCents, previousRevenueCents),
    },
    // Of the leads that arrived this month, how many have been won. An
    // imperfect measure — a lead from last month can close this one — but the
    // honest cohort version needs a window the dashboard does not have room to
    // explain, and Analytics carries that breakdown instead.
    conversionRatePercent: percent(leadsWonThisMonth, leadsThisMonth),

    recentLeads: recentLeads.map((lead) => ({
      id: lead.id,
      name: [lead.firstName, lead.lastName].filter(Boolean).join(' '),
      serviceRequested: lead.serviceRequested,
      estimatedValueCents: lead.estimatedValueCents,
    })),

    upcomingJobs: upcomingJobs.map((job) => ({
      id: job.id,
      title: job.title,
      customerName: [job.customer.firstName, job.customer.lastName].filter(Boolean).join(' '),
      priceCents: job.priceCents,
    })),
  };
}
