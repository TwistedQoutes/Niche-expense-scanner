import { describe, expect, it } from 'vitest';

import {
  calculateJobCost,
  fuelCost,
  labourCost,
  travelLabourCost,
  workedMinutes,
} from '@/lib/costs/engine';

/**
 * What a job cost, and the one way this feature could do real damage.
 *
 * The arithmetic is simple enough that the interesting tests are all about
 * *absent* numbers. A business that has not set a pay rate, or has never
 * measured the drive, must not be shown a profit figure computed as though those
 * were zero — that reads as "this job made $120" when the truth is "this job
 * made $120 minus something nobody has counted yet". An owner who drops a
 * customer, or keeps a bad one, on the strength of that number has been misled
 * by their own software.
 */

const RATE = 2_200; // $22/hour, what the business pays
const FUEL = 389; // $3.89/gallon
const MPG = 18_500; // 18.5 mpg, in thousandths

describe('the cost of the hours on the property', () => {
  it('charges the worked minutes at the pay rate', () => {
    // 90 minutes at $22/hour is $33.
    expect(labourCost({ workedMinutes: 90, driveMinutes: null, hourlyRateCents: RATE }).cents).toBe(3_300);
  });

  it('works in minutes rather than hours', () => {
    // 50 minutes at $22 is $18.33 — not two "rounded" quarter hours.
    expect(labourCost({ workedMinutes: 50, driveMinutes: null, hourlyRateCents: RATE }).cents).toBe(1_833);
  });

  it.each([
    ['nothing recorded how long it took', { workedMinutes: null, driveMinutes: null, hourlyRateCents: RATE }],
    ['the job took no time at all', { workedMinutes: 0, driveMinutes: null, hourlyRateCents: RATE }],
    ['nobody has set a pay rate', { workedMinutes: 90, driveMinutes: null, hourlyRateCents: null }],
    ['the rate is zero', { workedMinutes: 90, driveMinutes: null, hourlyRateCents: 0 }],
  ])('says so when %s, instead of costing the work at nothing', (_label, input) => {
    const result = labourCost(input);

    expect(result.cents).toBe(0);
    expect(result.missing?.part).toBe('labour');
    // The message names the thing the owner would have to go and fill in.
    expect(result.missing?.reason.length).toBeGreaterThan(20);
  });
});

describe('the cost of the hours in the truck', () => {
  it('pays for the drive both ways', () => {
    // 12 minutes each way is 24 paid minutes: $8.80 at $22/hour.
    expect(travelLabourCost({ workedMinutes: 90, driveMinutes: 12, hourlyRateCents: RATE }).cents).toBe(880);
  });

  it('says so when the drive has never been measured', () => {
    const result = travelLabourCost({ workedMinutes: 90, driveMinutes: null, hourlyRateCents: RATE });

    expect(result.cents).toBe(0);
    expect(result.missing?.part).toBe('travel');
  });

  it('does not repeat the missing pay rate the on-site hours already reported', () => {
    // Both halves need the same rate. Two identical complaints about one blank
    // field is a screen that looks broken rather than one that is helpful.
    const result = travelLabourCost({ workedMinutes: 90, driveMinutes: 12, hourlyRateCents: null });

    expect(result.cents).toBe(0);
    expect(result.missing).toBeNull();
  });
});

describe('the cost of the driving', () => {
  it('counts the round trip, not the distance out', () => {
    // 10 miles each way at 18.5 mpg is 1.081 gallons, which at $3.89 is $4.21.
    // Counting only the outbound leg would halve the fuel bill of every job.
    expect(fuelCost({ driveMiles: 10, fuelPricePerGallonCents: FUEL, vehicleMpgMilli: MPG }).cents).toBe(421);
  });

  it('scales with distance', () => {
    const near = fuelCost({ driveMiles: 5, fuelPricePerGallonCents: FUEL, vehicleMpgMilli: MPG }).cents;
    const far = fuelCost({ driveMiles: 40, fuelPricePerGallonCents: FUEL, vehicleMpgMilli: MPG }).cents;

    expect(far).toBeGreaterThan(near * 7);
  });

  it.each([
    ['the drive was never measured', { driveMiles: null, fuelPricePerGallonCents: FUEL, vehicleMpgMilli: MPG }],
    ['no fuel price is set', { driveMiles: 10, fuelPricePerGallonCents: null, vehicleMpgMilli: MPG }],
    ['no economy is set', { driveMiles: 10, fuelPricePerGallonCents: FUEL, vehicleMpgMilli: null }],
  ])('says so when %s', (_label, input) => {
    const result = fuelCost(input);

    expect(result.cents).toBe(0);
    expect(result.missing?.part).toBe('fuel');
  });
});

describe('a job, all in', () => {
  const complete = {
    priceCents: 12_500,
    labour: { workedMinutes: 90, driveMinutes: 12, hourlyRateCents: RATE },
    driveMiles: 10,
    fuelPricePerGallonCents: FUEL,
    vehicleMpgMilli: MPG,
    materialsCents: 1_500,
  };

  it('adds up what went out and what is left', () => {
    const cost = calculateJobCost(complete);

    // $33 on site, $8.80 driving, $4.21 of fuel and $15 of materials, against a
    // $125 price.
    expect(cost.labourCents).toBe(3_300);
    expect(cost.travelLabourCents).toBe(880);
    expect(cost.fuelCents).toBe(421);
    expect(cost.totalCostCents).toBe(6_101);
    expect(cost.profitCents).toBe(6_399);
    expect(cost.complete).toBe(true);
    expect(cost.missing).toEqual([]);
  });

  it('reports the margin against the price, which is how owners think about it', () => {
    // $63.99 kept out of $125 charged: 51.19%.
    expect(calculateJobCost(complete).marginBps).toBe(5_119);
  });

  it('finds the job that loses money', () => {
    /*
     * Forty minutes away for a fifty dollar mow — the job this whole feature
     * exists to find, and the one that looks fine on the invoice.
     *
     * 45 minutes on site is $16.50. The drive is 80 paid minutes, which is
     * $29.33, and 76 miles of fuel, which is $15.98. Fifty dollars of work
     * costs $61.81 to do, and the hour in the truck is most of it — which is why
     * counting drive time as labour is the difference between this screen being
     * useful and it being reassuring.
     */
    const cost = calculateJobCost({
      priceCents: 5_000,
      labour: { workedMinutes: 45, driveMinutes: 40, hourlyRateCents: RATE },
      driveMiles: 38,
      fuelPricePerGallonCents: FUEL,
      vehicleMpgMilli: MPG,
    });

    expect(cost.totalCostCents).toBe(6_181);
    expect(cost.profitCents).toBe(-1_181);
    expect(cost.marginBps).toBeLessThan(0);
  });

  it('marks the total incomplete rather than counting an unknown as free', () => {
    const cost = calculateJobCost({
      ...complete,
      labour: { workedMinutes: 90, driveMinutes: null, hourlyRateCents: null },
      driveMiles: null,
    });

    expect(cost.complete).toBe(false);
    expect(cost.missing.map((entry) => entry.part).sort()).toEqual(['fuel', 'labour']);

    /*
     * The number it does show is a floor: materials only. It must never be
     * presented as the profit, and `complete: false` is what the screen reads to
     * know that.
     */
    expect(cost.totalCostCents).toBe(1_500);
  });

  it('has no margin to report on a job charged at nothing', () => {
    const cost = calculateJobCost({ ...complete, priceCents: 0 });

    // Not zero, not infinity: there is no such percentage, and null is the
    // honest answer for a favour done for a neighbour.
    expect(cost.marginBps).toBeNull();
  });
});

describe('how long a job took', () => {
  const start = new Date('2026-05-04T09:00:00Z');

  it('is the gap between starting and finishing', () => {
    expect(workedMinutes({ startedAt: start, completedAt: new Date('2026-05-04T10:30:00Z') })).toBe(90);
  });

  it.each([
    ['it was never started', { startedAt: null, completedAt: new Date() }],
    ['it has not been finished', { startedAt: start, completedAt: null }],
    ['neither happened', { startedAt: null, completedAt: null }],
  ])('is unknown when %s', (_label, job) => {
    expect(workedMinutes(job)).toBeNull();
  });

  it('refuses a job that finished before it started', () => {
    // An edit can produce this. Negative hours would credit the business for
    // time nobody worked, which is worse than admitting the timestamps are wrong.
    expect(
      workedMinutes({ startedAt: start, completedAt: new Date('2026-05-04T08:00:00Z') }),
    ).toBeNull();
  });
});
