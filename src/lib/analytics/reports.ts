import { JobStatus, LeadSource, LeadStatus, QuoteStatus } from '@prisma/client';

import { monthRange, recentMonthKeys, type MonthKey } from '@/lib/dates';
import type { TenantClient } from '@/lib/db/tenant';

/**
 * The reports behind the analytics screen.
 *
 * Every figure here is computed from rows the business owns, through the tenant
 * client, so a report cannot accidentally aggregate across workspaces — which for
 * analytics would be the worst kind of leak: not one record shown to the wrong
 * person, but a competitor's revenue folded invisibly into your own chart.
 */

export type MonthlyPoint = {
  month: MonthKey;
  /** Revenue from jobs completed in that month. */
  revenueCents: number;
  jobsCompleted: number;
  leads: number;
};

/**
 * Twelve months of revenue, leads and completed jobs.
 *
 * Three `groupBy` queries rather than thirty-six counts, then bucketed in memory.
 * A month with no activity still appears, with zeroes: a trend line that silently
 * skips the quiet months makes a seasonal business look like it grew when it only
 * stopped reporting.
 */
export async function monthlySeries(
  db: TenantClient,
  options: { months?: number; now?: Date } = {},
): Promise<MonthlyPoint[]> {
  const now = options.now ?? new Date();
  const keys = recentMonthKeys(options.months ?? 12, now);
  const from = monthRange(keys[0]!).start;

  const [completedJobs, leads] = await Promise.all([
    db.job.findMany({
      where: { status: JobStatus.COMPLETED, completedAt: { gte: from } },
      select: { completedAt: true, priceCents: true },
    }),
    db.lead.findMany({
      where: { createdAt: { gte: from } },
      select: { createdAt: true },
    }),
  ]);

  const empty = (): Omit<MonthlyPoint, 'month'> => ({
    revenueCents: 0,
    jobsCompleted: 0,
    leads: 0,
  });

  const buckets = new Map(keys.map((key) => [key, empty()]));

  for (const job of completedJobs) {
    if (!job.completedAt) continue;
    const bucket = buckets.get(job.completedAt.toISOString().slice(0, 7));
    if (!bucket) continue;
    bucket.revenueCents += job.priceCents;
    bucket.jobsCompleted += 1;
  }

  for (const lead of leads) {
    const bucket = buckets.get(lead.createdAt.toISOString().slice(0, 7));
    if (bucket) bucket.leads += 1;
  }

  return keys.map((month) => ({ month, ...buckets.get(month)! }));
}

export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  /** Share of the stage above, as a whole percentage. */
  conversionFromPreviousPercent: number | null;
  /** Share of the very first stage. */
  shareOfTopPercent: number;
};

/**
 * The lead-to-job funnel.
 *
 * Counted as **cumulative reach**, not as "currently sitting in this stage": a
 * lead that has become a completed job must still count as having been quoted,
 * or the funnel shows the pipeline emptying as the business succeeds. So each
 * stage counts everything that got at least that far.
 */
export async function loadFunnel(
  db: TenantClient,
  options: { since?: Date } = {},
): Promise<FunnelStage[]> {
  const createdFilter = options.since ? { createdAt: { gte: options.since } } : {};

  const [leads, qualified, quoted, won, completed] = await Promise.all([
    db.lead.count({ where: createdFilter }),
    // Anything the AI scored, or that a human moved past New.
    db.lead.count({
      where: {
        ...createdFilter,
        OR: [{ aiQualifiedAt: { not: null } }, { status: { not: LeadStatus.NEW } }],
      },
    }),
    db.lead.count({ where: { ...createdFilter, quotes: { some: {} } } }),
    db.lead.count({
      where: {
        ...createdFilter,
        OR: [{ status: LeadStatus.WON }, { quotes: { some: { status: QuoteStatus.ACCEPTED } } }],
      },
    }),
    db.lead.count({
      where: {
        ...createdFilter,
        quotes: { some: { jobs: { some: { status: JobStatus.COMPLETED } } } },
      },
    }),
  ]);

  const raw = [
    { key: 'leads', label: 'Leads', count: leads },
    { key: 'qualified', label: 'Qualified', count: qualified },
    { key: 'quoted', label: 'Quoted', count: quoted },
    { key: 'won', label: 'Won', count: won },
    { key: 'completed', label: 'Completed', count: completed },
  ];

  const top = raw[0]!.count;

  return raw.map((stage, index) => {
    const previous = index === 0 ? null : raw[index - 1]!.count;

    return {
      ...stage,
      conversionFromPreviousPercent:
        previous === null || previous === 0 ? null : Math.round((stage.count / previous) * 100),
      shareOfTopPercent: top === 0 ? 0 : Math.round((stage.count / top) * 100),
    };
  });
}

export type SourceRow = {
  source: LeadSource;
  label: string;
  leads: number;
  won: number;
  /** Revenue from jobs traceable to a lead from this source. */
  revenueCents: number;
  winRatePercent: number;
};

const SOURCE_LABEL: Record<LeadSource, string> = {
  [LeadSource.WEBSITE]: 'Website form',
  [LeadSource.PHONE_CALL]: 'Phone call',
  [LeadSource.MISSED_CALL]: 'Missed call',
  [LeadSource.SMS]: 'Text message',
  [LeadSource.EMAIL]: 'Email',
  [LeadSource.REFERRAL]: 'Referral',
  [LeadSource.GOOGLE]: 'Google',
  [LeadSource.FACEBOOK]: 'Facebook',
  [LeadSource.WALK_IN]: 'Walk-in',
  [LeadSource.REPEAT_CUSTOMER]: 'Repeat customer',
  [LeadSource.MANUAL]: 'Added by hand',
  [LeadSource.OTHER]: 'Other',
};

/**
 * Where the work comes from, and what it is worth.
 *
 * The revenue column is the reason this report exists. Counting leads per source
 * flatters whichever channel produces the most enquiries; an owner deciding where
 * to spend needs to know which produces the most *money*, and those are often not
 * the same channel.
 */
export async function loadSources(
  db: TenantClient,
  options: { since?: Date } = {},
): Promise<SourceRow[]> {
  const createdFilter = options.since ? { createdAt: { gte: options.since } } : {};

  const [bySource, wonBySource, revenueRows] = await Promise.all([
    db.lead.groupBy({ by: ['source'], where: createdFilter, _count: { _all: true } }),
    db.lead.groupBy({
      by: ['source'],
      where: { ...createdFilter, status: LeadStatus.WON },
      _count: { _all: true },
    }),
    db.job.findMany({
      where: {
        status: JobStatus.COMPLETED,
        ...(options.since ? { completedAt: { gte: options.since } } : {}),
        quote: { leadId: { not: null } },
      },
      select: { priceCents: true, quote: { select: { lead: { select: { source: true } } } } },
    }),
  ]);

  const leadCounts = new Map(bySource.map((row) => [row.source, row._count._all]));
  const wonCounts = new Map(wonBySource.map((row) => [row.source, row._count._all]));

  const revenue = new Map<LeadSource, number>();
  for (const job of revenueRows) {
    const source = job.quote?.lead?.source;
    if (!source) continue;
    revenue.set(source, (revenue.get(source) ?? 0) + job.priceCents);
  }

  const rows: SourceRow[] = [...leadCounts.keys()].map((source) => {
    const leads = leadCounts.get(source) ?? 0;
    const won = wonCounts.get(source) ?? 0;

    return {
      source,
      label: SOURCE_LABEL[source],
      leads,
      won,
      revenueCents: revenue.get(source) ?? 0,
      winRatePercent: leads === 0 ? 0 : Math.round((won / leads) * 100),
    };
  });

  // Most valuable first, falling back to volume so a source with no completed
  // work yet still has a stable position rather than jumping about.
  return rows.sort((a, b) => b.revenueCents - a.revenueCents || b.leads - a.leads);
}

export type ServiceRow = {
  name: string;
  jobs: number;
  revenueCents: number;
  averageCents: number;
};

/** Which services actually earn. */
export async function loadServiceMix(
  db: TenantClient,
  options: { since?: Date; limit?: number } = {},
): Promise<ServiceRow[]> {
  const jobs = await db.job.findMany({
    where: {
      status: JobStatus.COMPLETED,
      ...(options.since ? { completedAt: { gte: options.since } } : {}),
    },
    select: { priceCents: true, service: { select: { name: true } }, title: true },
  });

  const totals = new Map<string, { jobs: number; revenueCents: number }>();

  for (const job of jobs) {
    // A job created by hand has no service attached; grouping those as "Other"
    // is honest, whereas dropping them would make the revenue column disagree
    // with the headline figure.
    const name = job.service?.name ?? 'Other work';
    const entry = totals.get(name) ?? { jobs: 0, revenueCents: 0 };
    entry.jobs += 1;
    entry.revenueCents += job.priceCents;
    totals.set(name, entry);
  }

  return [...totals.entries()]
    .map(([name, entry]) => ({
      name,
      jobs: entry.jobs,
      revenueCents: entry.revenueCents,
      averageCents: entry.jobs === 0 ? 0 : Math.round(entry.revenueCents / entry.jobs),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, options.limit ?? 8);
}

export type SpeedReport = {
  /** Median hours from a lead arriving to its first quote. */
  medianHoursToQuote: number | null;
  /** Median hours from a quote being sent to the customer answering. */
  medianHoursToResponse: number | null;
  quotesMeasured: number;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  /*
   * The median, not the mean. One quote that sat unanswered for three months
   * drags an average past the point of being useful, and response time is exactly
   * the measure where a handful of outliers are normal.
   */
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * How fast the business moves, which is the product's whole thesis.
 */
export async function loadSpeed(
  db: TenantClient,
  options: { since?: Date } = {},
): Promise<SpeedReport> {
  const quotes = await db.quote.findMany({
    where: {
      sentAt: { not: null },
      ...(options.since ? { createdAt: { gte: options.since } } : {}),
    },
    select: {
      sentAt: true,
      respondedAt: true,
      lead: { select: { createdAt: true } },
    },
  });

  const toQuote: number[] = [];
  const toResponse: number[] = [];

  for (const quote of quotes) {
    if (quote.lead && quote.sentAt) {
      const hours = (quote.sentAt.getTime() - quote.lead.createdAt.getTime()) / 3_600_000;
      // A quote sent before its lead existed is impossible; a negative value
      // would be imported or hand-edited data, and averaging it in would be
      // worse than leaving it out.
      if (hours >= 0) toQuote.push(hours);
    }

    if (quote.sentAt && quote.respondedAt) {
      const hours = (quote.respondedAt.getTime() - quote.sentAt.getTime()) / 3_600_000;
      if (hours >= 0) toResponse.push(hours);
    }
  }

  return {
    medianHoursToQuote: median(toQuote),
    medianHoursToResponse: median(toResponse),
    quotesMeasured: quotes.length,
  };
}

export type TopCustomer = {
  id: string;
  name: string;
  jobsCompleted: number;
  lifetimeValueCents: number;
};

export async function loadTopCustomers(db: TenantClient, limit = 8): Promise<TopCustomer[]> {
  const customers = await db.customer.findMany({
    where: { lifetimeValueCents: { gt: 0 } },
    orderBy: { lifetimeValueCents: 'desc' },
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      jobsCompleted: true,
      lifetimeValueCents: true,
    },
  });

  return customers.map((customer) => ({
    id: customer.id,
    name: [customer.firstName, customer.lastName].filter(Boolean).join(' '),
    jobsCompleted: customer.jobsCompleted,
    lifetimeValueCents: customer.lifetimeValueCents,
  }));
}

export type AnalyticsReport = {
  monthly: MonthlyPoint[];
  funnel: FunnelStage[];
  sources: SourceRow[];
  services: ServiceRow[];
  speed: SpeedReport;
  topCustomers: TopCustomer[];
};

/** Everything the analytics screen needs, in one parallel burst. */
export async function loadAnalytics(
  db: TenantClient,
  options: { since?: Date; now?: Date } = {},
): Promise<AnalyticsReport> {
  const [monthly, funnel, sources, services, speed, topCustomers] = await Promise.all([
    monthlySeries(db, { now: options.now }),
    loadFunnel(db, options),
    loadSources(db, options),
    loadServiceMix(db, options),
    loadSpeed(db, options),
    loadTopCustomers(db),
  ]);

  return { monthly, funnel, sources, services, speed, topCustomers };
}
