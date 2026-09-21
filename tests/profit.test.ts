import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TenantClient } from '@/lib/db/tenant';

/**
 * The week's jobs, added up honestly.
 *
 * The arithmetic of one job is tested in costs.test.ts. What is tested here is
 * what happens when jobs are put together, and the rule that makes the total
 * safe to repeat out loud: **a job whose cost is unknown is not in it.**
 *
 * That rule is easy to state and easy to lose. Every shortcut — treating a
 * missing pay rate as zero, averaging the rates that do exist, quietly dropping
 * the labour line — produces a bigger "kept" figure and a happier screen, and
 * every one of them is a lie in the same direction. An owner who tells their
 * accountant they kept $4,200 has to have kept $4,200.
 */

const organizationFindUnique = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/client', () => ({
  prisma: { organization: { findUnique: organizationFindUnique } },
}));

const { loadProfitReport } = await import('@/lib/costs/report');

const RATE = 2_200; // $22/hour
const FUEL = 389;
const MPG = 18_500;

type JobFixture = {
  id: string;
  number: string;
  title: string;
  priceCents: number;
  minutes: number | null;
  assignedUserId: string | null;
  customer: { id: string; name: string };
  service: string | null;
  driveMiles?: number | null;
  driveMinutes?: number | null;
};

const START = new Date('2026-05-04T09:00:00Z');

function stubClient(
  jobs: JobFixture[],
  options: {
    entries?: { jobId: string; userId: string; minutes: number }[];
    rates?: { userId: string; hourlyRateCents: number | null }[];
    fuel?: { fuelPricePerGallonCents: number | null; vehicleMpgMilli: number | null };
  } = {},
) {
  organizationFindUnique.mockResolvedValue(
    options.fuel ?? { fuelPricePerGallonCents: FUEL, vehicleMpgMilli: MPG },
  );

  return {
    job: {
      findMany: vi.fn().mockResolvedValue(
        jobs.map((job) => ({
          id: job.id,
          number: job.number,
          title: job.title,
          priceCents: job.priceCents,
          startedAt: job.minutes === null ? null : START,
          completedAt: job.minutes === null ? START : new Date(START.getTime() + job.minutes * 60_000),
          assignedUserId: job.assignedUserId,
          customer: { id: job.customer.id, firstName: job.customer.name, lastName: null },
          service: job.service ? { id: job.service, name: job.service } : null,
          property: {
            driveMilesFromBase: job.driveMiles ?? 10,
            driveMinutesFromBase: job.driveMinutes ?? 12,
          },
        })),
      ),
    },
    timeEntry: {
      findMany: vi.fn().mockResolvedValue(
        (options.entries ?? []).map((entry) => ({
          jobId: entry.jobId,
          userId: entry.userId,
          startedAt: START,
          endedAt: new Date(START.getTime() + entry.minutes * 60_000),
        })),
      ),
    },
    membership: {
      findMany: vi.fn().mockResolvedValue(options.rates ?? [{ userId: 'sam', hourlyRateCents: RATE }]),
    },
  } as unknown as TenantClient;
}

const job = (over: Partial<JobFixture> & { id: string }): JobFixture => ({
  number: `J-${over.id}`,
  title: `Job ${over.id}`,
  priceCents: 12_500,
  minutes: 90,
  assignedUserId: 'sam',
  customer: { id: 'cust-1', name: 'Dana' },
  service: 'Mowing',
  ...over,
});

beforeEach(() => {
  organizationFindUnique.mockReset();
});

describe('the headline figures', () => {
  it('adds up what was charged, what it cost, and what is left', async () => {
    const db = stubClient([job({ id: '1' }), job({ id: '2' })]);

    const report = await loadProfitReport(db, 'org-1');

    // Two identical jobs: $125 each charged, and each costing $33 on site,
    // $8.80 driving and $4.21 of fuel.
    expect(report.totals.jobs).toBe(2);
    expect(report.totals.chargedCents).toBe(25_000);
    expect(report.totals.costCents).toBe(9_202);
    expect(report.totals.keptCents).toBe(15_798);
  });

  it('reports the margin against what was charged', async () => {
    const db = stubClient([job({ id: '1' })]);

    const report = await loadProfitReport(db, 'org-1');

    // $78.99 kept of $125: $33.00 on site, $8.80 driving, $4.21 of fuel.
    expect(report.totals.marginBps).toBe(6_319);
  });

  it('has no margin to report when nothing was charged', async () => {
    const db = stubClient([job({ id: '1', priceCents: 0 })]);

    const report = await loadProfitReport(db, 'org-1');

    expect(report.totals.marginBps).toBeNull();
  });

  it('says nothing at all when no job in the period finished', async () => {
    const db = stubClient([]);

    const report = await loadProfitReport(db, 'org-1');

    expect(report.totals).toEqual({
      jobs: 0,
      chargedCents: 0,
      costCents: 0,
      keptCents: 0,
      marginBps: null,
    });
  });
});

describe('jobs whose cost is not known', () => {
  it('keeps them out of the totals entirely', async () => {
    /*
     * The rule this file exists for. The second job has no pay rate for whoever
     * did it, so its cost is unknown — not zero. Counting it would add $125 of
     * revenue against $4.21 of fuel and report a margin nobody earned.
     */
    const db = stubClient([job({ id: '1' }), job({ id: '2', assignedUserId: 'unpaid' })], {
      rates: [
        { userId: 'sam', hourlyRateCents: RATE },
        { userId: 'unpaid', hourlyRateCents: null },
      ],
    });

    const report = await loadProfitReport(db, 'org-1');

    expect(report.totals.jobs).toBe(1);
    expect(report.totals.chargedCents).toBe(12_500);
    expect(report.uncosted).toHaveLength(1);
    expect(report.uncosted[0]!.number).toBe('J-2');
  });

  it('counts what they are waiting on, by kind rather than by job', async () => {
    // The fix is never per job: one pay rate unblocks all of them at once, and
    // forty identical warnings is a screen somebody closes.
    const db = stubClient(
      [
        job({ id: '1', assignedUserId: 'unpaid' }),
        job({ id: '2', assignedUserId: 'unpaid' }),
        job({ id: '3', assignedUserId: 'unpaid' }),
      ],
      { rates: [{ userId: 'unpaid', hourlyRateCents: null }] },
    );

    const report = await loadProfitReport(db, 'org-1');

    const labour = report.blockers.find((blocker) => blocker.part === 'labour');
    expect(labour?.jobs).toBe(3);
    expect(report.blockers.filter((blocker) => blocker.part === 'labour')).toHaveLength(1);
  });

  it('names the commonest blocker first', async () => {
    const db = stubClient(
      [
        job({ id: '1', assignedUserId: 'unpaid' }),
        job({ id: '2', assignedUserId: 'unpaid' }),
        job({ id: '3', driveMiles: null, driveMinutes: null }),
      ],
      {
        rates: [
          { userId: 'sam', hourlyRateCents: RATE },
          { userId: 'unpaid', hourlyRateCents: null },
        ],
      },
    );

    const report = await loadProfitReport(db, 'org-1');

    expect(report.blockers[0]!.part).toBe('labour');
    expect(report.blockers[0]!.jobs).toBe(2);
  });
});

describe('the order jobs are shown in', () => {
  it('puts the thinnest margin first, not the biggest loss', async () => {
    /*
     * A $12 loss on an $80 mow is a worse business than a $40 profit on a
     * $4,000 install, and an owner reading this list is asking "which of these
     * should I stop doing?" — a question about rate, not size.
     */
    const db = stubClient([
      job({ id: 'fat', priceCents: 400_000, minutes: 90 }),
      job({ id: 'thin', priceCents: 6_000, minutes: 90 }),
    ]);

    const report = await loadProfitReport(db, 'org-1');

    expect(report.ranked[0]!.number).toBe('J-thin');
  });

  it('singles out the jobs that lost money', async () => {
    // Forty minutes away for a fifty dollar mow, which is the job the whole
    // feature exists to find.
    const db = stubClient([
      job({ id: 'good' }),
      job({ id: 'bad', priceCents: 5_000, minutes: 45, driveMiles: 38, driveMinutes: 40 }),
    ]);

    const report = await loadProfitReport(db, 'org-1');

    expect(report.losing).toHaveLength(1);
    expect(report.losing[0]!.number).toBe('J-bad');
    expect(report.losing[0]!.cost.profitCents).toBeLessThan(0);
  });
});

describe('grouping', () => {
  it('adds a customer up across their jobs', async () => {
    const db = stubClient([
      job({ id: '1', customer: { id: 'dana', name: 'Dana' } }),
      job({ id: '2', customer: { id: 'dana', name: 'Dana' } }),
      job({ id: '3', customer: { id: 'kim', name: 'Kim' } }),
    ]);

    const report = await loadProfitReport(db, 'org-1');

    const dana = report.byCustomer.find((row) => row.key === 'dana');
    expect(dana?.jobs).toBe(2);
    expect(dana?.chargedCents).toBe(25_000);
  });

  it('puts the worst customer at the top, however loyal', async () => {
    const db = stubClient([
      job({ id: '1', customer: { id: 'profitable', name: 'Profitable' } }),
      job({
        id: '2',
        customer: { id: 'costly', name: 'Costly' },
        priceCents: 5_000,
        minutes: 45,
        driveMiles: 38,
        driveMinutes: 40,
      }),
    ]);

    const report = await loadProfitReport(db, 'org-1');

    expect(report.byCustomer[0]!.key).toBe('costly');
    expect(report.byCustomer[0]!.keptCents).toBeLessThan(0);
  });

  it('gives jobs with no service somewhere to go', async () => {
    // Otherwise they vanish from the breakdown and the columns do not add up to
    // the headline, which reads as a bug in the totals.
    const db = stubClient([job({ id: '1', service: null })]);

    const report = await loadProfitReport(db, 'org-1');

    expect(report.byService).toHaveLength(1);
    expect(report.byService[0]!.label).toBe('No service set');
  });
});

describe('what it asks the database for', () => {
  it('costs a hundred jobs without a query per job', async () => {
    /*
     * The performance constraint, asserted rather than hoped for. The obvious
     * implementation calls the single-job costing function in a loop; at a few
     * hundred round trips this screen becomes one an owner stops opening, and
     * the regression would never show up on a test workspace with four jobs.
     */
    const many = Array.from({ length: 100 }, (_, index) => job({ id: String(index) }));
    const db = stubClient(many);

    await loadProfitReport(db, 'org-1');

    expect(db.job.findMany).toHaveBeenCalledTimes(1);
    expect(db.timeEntry.findMany).toHaveBeenCalledTimes(1);
    expect(db.membership.findMany).toHaveBeenCalledTimes(1);
    expect(organizationFindUnique).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing else at all when the period is empty', async () => {
    // No jobs means no clock entries and no rates worth reading.
    const db = stubClient([]);

    await loadProfitReport(db, 'org-1');

    expect(db.timeEntry.findMany).not.toHaveBeenCalled();
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });
});

describe('the clock, in bulk', () => {
  it('costs each person on a job at their own rate', async () => {
    const db = stubClient([job({ id: '1', priceCents: 20_000, minutes: 90 })], {
      entries: [
        { jobId: '1', userId: 'sam', minutes: 90 },
        { jobId: '1', userId: 'robin', minutes: 60 },
      ],
      rates: [
        { userId: 'sam', hourlyRateCents: 2_200 },
        { userId: 'robin', hourlyRateCents: 1_800 },
      ],
    });

    const report = await loadProfitReport(db, 'org-1');

    // 90m at $22 plus 60m at $18.
    expect(report.ranked[0]!.cost.labourCents).toBe(5_100);
  });

  it('adds up somebody who clocked in twice on one job', async () => {
    // Morning, lunch, afternoon. Two entries, one person, one day's pay.
    const db = stubClient([job({ id: '1', priceCents: 20_000 })], {
      entries: [
        { jobId: '1', userId: 'sam', minutes: 60 },
        { jobId: '1', userId: 'sam', minutes: 30 },
      ],
    });

    const report = await loadProfitReport(db, 'org-1');

    expect(report.ranked[0]!.cost.labourCents).toBe(3_300);
  });

  it('prefers the clock over the job timestamps', async () => {
    /*
     * The job says three hours because it was left open over lunch; the clock
     * says ninety minutes of actual work. Believing the job would invent an hour
     * and a half of wages nobody worked.
     */
    const db = stubClient([job({ id: '1', minutes: 180 })], {
      entries: [{ jobId: '1', userId: 'sam', minutes: 90 }],
    });

    const report = await loadProfitReport(db, 'org-1');

    expect(report.ranked[0]!.cost.labourCents).toBe(3_300);
  });
});
