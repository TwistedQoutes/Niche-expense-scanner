import { JobStatus } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import type { TenantClient } from '@/lib/db/tenant';
import { crewLabour } from '@/lib/costs/crew';
import { calculateJobCost, workedMinutes, type JobCost, type MissingCost } from '@/lib/costs/engine';

/**
 * The week's work, ranked by what it actually kept.
 *
 * The job page answers "was this job worth doing?". This answers the question
 * that follows and is harder to see from inside any one job: *which of them are
 * worth doing at all?* A business can be fully booked and losing money on every
 * third job, and no single job page will ever say so — the loss is only visible
 * when the jobs are lined up next to each other and sorted by the thing that
 * matters.
 *
 * Two constraints shape this file.
 *
 * **It costs many jobs in four queries, not four per job.** The obvious
 * implementation calls the single-job costing function in a loop, which for a
 * quiet month is a few hundred round trips and for a busy one is a screen an
 * owner stops opening. Everything needed is fetched in bulk and joined in
 * memory: the jobs, their clock entries, the workspace's pay rates, and the
 * fuel settings. Adding a job adds no queries.
 *
 * **A total is never built on unknowns.** This is the same rule as the job card
 * and it matters more here, because a headline figure is what somebody quotes at
 * their accountant. A job whose pay rate is missing has an unknown cost, not a
 * zero one, so it is excluded from the totals and counted separately with what it
 * is waiting on. "You kept $4,200 across 31 jobs" has to mean 31 jobs that were
 * fully costed, or the sentence is a lie in the direction that feels good.
 */

export type JobProfit = {
  jobId: string;
  number: string;
  title: string;
  completedAt: Date | null;
  customerId: string;
  customerName: string;
  serviceName: string | null;
  cost: JobCost;
};

export type GroupProfit = {
  key: string;
  label: string;
  jobs: number;
  chargedCents: number;
  costCents: number;
  keptCents: number;
  marginBps: number | null;
};

export type ProfitReport = {
  /** Fully costed jobs, worst margin first — the order an owner wants. */
  ranked: JobProfit[];
  /** Jobs that cost more to do than they charged. */
  losing: JobProfit[];
  /** Jobs whose cost could not be worked out, and are therefore in no total. */
  uncosted: JobProfit[];
  totals: {
    jobs: number;
    chargedCents: number;
    costCents: number;
    keptCents: number;
    marginBps: number | null;
  };
  /** What is stopping the uncosted jobs, counted — so the fix is obvious. */
  blockers: { part: MissingCost['part']; reason: string; jobs: number }[];
  byCustomer: GroupProfit[];
  byService: GroupProfit[];
};

export async function loadProfitReport(
  db: TenantClient,
  organizationId: string,
  range: { since?: Date; until?: Date } = {},
): Promise<ProfitReport> {
  /*
   * Completed jobs only.
   *
   * Profit is about work that happened. A scheduled job has a price and no
   * cost, and including it would show a margin of 100% on work nobody has done
   * yet — which is not optimism, it is a wrong number at the top of the screen.
   */
  const jobs = await db.job.findMany({
    where: {
      status: JobStatus.COMPLETED,
      ...(range.since || range.until
        ? {
            completedAt: {
              ...(range.since ? { gte: range.since } : {}),
              ...(range.until ? { lte: range.until } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      number: true,
      title: true,
      priceCents: true,
      startedAt: true,
      completedAt: true,
      assignedUserId: true,
      customer: { select: { id: true, firstName: true, lastName: true } },
      service: { select: { id: true, name: true } },
      property: { select: { driveMilesFromBase: true, driveMinutesFromBase: true } },
    },
    orderBy: { completedAt: 'desc' },
  });

  if (jobs.length === 0) return emptyReport();

  const jobIds = jobs.map((job) => job.id);

  const [entries, memberships, organization] = await Promise.all([
    /*
     * Every closed clock entry for every job on the screen, in one read. Open
     * entries are left out here as they are everywhere else: a running clock is
     * not a cost yet.
     */
    db.timeEntry.findMany({
      where: { jobId: { in: jobIds }, endedAt: { not: null } },
      select: { jobId: true, userId: true, startedAt: true, endedAt: true },
    }),
    /*
     * Every pay rate in the workspace, rather than the ones for the people who
     * happen to appear above. A crew is a handful of rows, and fetching them all
     * means the lookup below is a map read instead of a query.
     */
    db.membership.findMany({ select: { userId: true, hourlyRateCents: true } }),
    // The tenant itself, so it is read with the id from the verified session.
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { fuelPricePerGallonCents: true, vehicleMpgMilli: true },
    }),
  ]);

  const rates = new Map(memberships.map((row) => [row.userId, row.hourlyRateCents]));
  const rateFor = (userId: string) => rates.get(userId) ?? null;

  /** jobId → userId → minutes worked. */
  const clockedByJob = new Map<string, Map<string, number>>();

  for (const entry of entries) {
    if (!entry.endedAt) continue;

    const minutes = (entry.endedAt.getTime() - entry.startedAt.getTime()) / 60_000;
    // The same guard the single-job path applies: time that ran backwards is a
    // data problem to notice, not an hour to subtract from the bill.
    if (!Number.isFinite(minutes) || minutes <= 0) continue;

    const perPerson = clockedByJob.get(entry.jobId) ?? new Map<string, number>();
    perPerson.set(entry.userId, (perPerson.get(entry.userId) ?? 0) + Math.round(minutes));
    clockedByJob.set(entry.jobId, perPerson);
  }

  const costed: JobProfit[] = jobs.map((job) => {
    const clocked = [...(clockedByJob.get(job.id) ?? new Map<string, number>())].map(
      ([userId, minutes]) => ({ userId, minutes }),
    );

    const cost = calculateJobCost({
      priceCents: job.priceCents,
      crew: crewLabour({
        clocked,
        assignedUserId: job.assignedUserId,
        jobWorkedMinutes: workedMinutes(job),
        driveMinutes: job.property?.driveMinutesFromBase ?? null,
        rateFor,
      }),
      driveMiles: job.property?.driveMilesFromBase ?? null,
      fuelPricePerGallonCents: organization?.fuelPricePerGallonCents ?? null,
      vehicleMpgMilli: organization?.vehicleMpgMilli ?? null,
    });

    return {
      jobId: job.id,
      number: job.number,
      title: job.title,
      completedAt: job.completedAt,
      customerId: job.customer.id,
      customerName: [job.customer.firstName, job.customer.lastName].filter(Boolean).join(' '),
      serviceName: job.service?.name ?? null,
      cost,
    };
  });

  const complete = costed.filter((row) => row.cost.complete);
  const uncosted = costed.filter((row) => !row.cost.complete);

  const chargedCents = sum(complete, (row) => row.cost.totalCostCents + row.cost.profitCents);
  const costCents = sum(complete, (row) => row.cost.totalCostCents);
  const keptCents = chargedCents - costCents;

  return {
    /*
     * Worst first. A list sorted by date is a diary; this is sorted by the thing
     * an owner can act on, and the job that lost money is at the top where it
     * cannot be missed.
     */
    ranked: [...complete].sort(byWorstMargin),
    losing: complete.filter((row) => row.cost.profitCents < 0).sort(byWorstMargin),
    uncosted,
    totals: {
      jobs: complete.length,
      chargedCents,
      costCents,
      keptCents,
      marginBps: chargedCents > 0 ? Math.round((keptCents / chargedCents) * 10_000) : null,
    },
    blockers: countBlockers(uncosted),
    byCustomer: group(complete, (row) => [row.customerId, row.customerName]),
    byService: group(complete, (row) => [row.serviceName ?? 'none', row.serviceName ?? 'No service set']),
  };
}

function sum<T>(rows: T[], of: (row: T) => number): number {
  return rows.reduce((total, row) => total + of(row), 0);
}

/**
 * Margin, not absolute profit.
 *
 * A $12 loss on an $80 mow is a worse business than a $40 profit on a $4,000
 * install, and sorting by the money would bury the first behind the second. The
 * question this screen answers is "which of these should I stop doing?", and
 * that is a question about rate, not size.
 */
function byWorstMargin(a: JobProfit, b: JobProfit): number {
  const left = a.cost.marginBps ?? Number.POSITIVE_INFINITY;
  const right = b.cost.marginBps ?? Number.POSITIVE_INFINITY;
  return left - right;
}

/**
 * What is stopping the jobs that could not be costed.
 *
 * Counted by kind rather than listed per job, because the fix is never per job:
 * it is one pay rate, or one fuel price, and setting it uncosts nothing and
 * fixes forty rows at once. "18 jobs are waiting on a pay rate" is a sentence
 * somebody acts on; eighteen identical warnings is a screen they close.
 */
function countBlockers(uncosted: JobProfit[]): ProfitReport['blockers'] {
  const counts = new Map<MissingCost['part'], { reason: string; jobs: number }>();

  for (const row of uncosted) {
    for (const missing of row.cost.missing) {
      const existing = counts.get(missing.part);
      counts.set(missing.part, {
        reason: existing?.reason ?? missing.reason,
        jobs: (existing?.jobs ?? 0) + 1,
      });
    }
  }

  return [...counts]
    .map(([part, value]) => ({ part, reason: value.reason, jobs: value.jobs }))
    .sort((a, b) => b.jobs - a.jobs);
}

function group(
  rows: JobProfit[],
  keyOf: (row: JobProfit) => [string, string],
): GroupProfit[] {
  const groups = new Map<string, GroupProfit>();

  for (const row of rows) {
    const [key, label] = keyOf(row);
    const charged = row.cost.totalCostCents + row.cost.profitCents;

    const existing = groups.get(key) ?? {
      key,
      label,
      jobs: 0,
      chargedCents: 0,
      costCents: 0,
      keptCents: 0,
      marginBps: null,
    };

    existing.jobs += 1;
    existing.chargedCents += charged;
    existing.costCents += row.cost.totalCostCents;
    existing.keptCents += row.cost.profitCents;
    groups.set(key, existing);
  }

  return [...groups.values()]
    .map((entry) => ({
      ...entry,
      marginBps:
        entry.chargedCents > 0
          ? Math.round((entry.keptCents / entry.chargedCents) * 10_000)
          : null,
    }))
    .sort((a, b) => (a.marginBps ?? Number.POSITIVE_INFINITY) - (b.marginBps ?? Number.POSITIVE_INFINITY));
}

function emptyReport(): ProfitReport {
  return {
    ranked: [],
    losing: [],
    uncosted: [],
    totals: { jobs: 0, chargedCents: 0, costCents: 0, keptCents: 0, marginBps: null },
    blockers: [],
    byCustomer: [],
    byService: [],
  };
}
