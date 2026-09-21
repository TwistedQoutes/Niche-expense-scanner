import { describe, expect, it } from 'vitest';

import { crewLabour } from '@/lib/costs/crew';

/**
 * Which record of "who was there" to believe.
 *
 * One small function, used by both the job page and the profit view, deciding
 * between the clock and the job's own timestamps. Getting this wrong is not a
 * display bug: believing the wrong source halves a two-person job's wage bill,
 * or invents hours for somebody who never turned up.
 */

const RATES: Record<string, number | null> = {
  sam: 2_200,
  robin: 1_800,
  newHire: null,
};

const rateFor = (userId: string) => RATES[userId] ?? null;

describe('who worked the job', () => {
  it('uses the clock when anybody clocked in', () => {
    const crew = crewLabour({
      clocked: [
        { userId: 'sam', minutes: 90 },
        { userId: 'robin', minutes: 60 },
      ],
      assignedUserId: 'sam',
      // Deliberately different from the clock: the job's own span covers the
      // whole visit, and believing it as well would pay Sam twice.
      jobWorkedMinutes: 150,
      driveMinutes: 12,
      rateFor,
    });

    expect(crew).toEqual([
      { workedMinutes: 90, driveMinutes: 12, hourlyRateCents: 2_200 },
      { workedMinutes: 60, driveMinutes: 12, hourlyRateCents: 1_800 },
    ]);
  });

  it('gives everybody in the truck the same drive', () => {
    // They rode together and are all paid for the ride. Counting it once per job
    // would understate exactly the distant jobs worth finding.
    const crew = crewLabour({
      clocked: [
        { userId: 'sam', minutes: 60 },
        { userId: 'robin', minutes: 60 },
      ],
      assignedUserId: null,
      jobWorkedMinutes: null,
      driveMinutes: 20,
      rateFor,
    });

    expect(crew.every((person) => person.driveMinutes === 20)).toBe(true);
  });

  it('falls back to the job and its assignee when nobody clocked in', () => {
    /*
     * Not a legacy path. This is what a business that never uses the clock gets,
     * and what covers work done before anybody started clocking in — the same
     * answer the product gave before the clock existed.
     */
    const crew = crewLabour({
      clocked: [],
      assignedUserId: 'sam',
      jobWorkedMinutes: 120,
      driveMinutes: 15,
      rateFor,
    });

    expect(crew).toEqual([{ workedMinutes: 120, driveMinutes: 15, hourlyRateCents: 2_200 }]);
  });

  it('has no rate to apply when the job is assigned to nobody', () => {
    const crew = crewLabour({
      clocked: [],
      assignedUserId: null,
      jobWorkedMinutes: 120,
      driveMinutes: null,
      rateFor,
    });

    // Reported as unknown by the engine rather than costed at zero.
    expect(crew).toEqual([{ workedMinutes: 120, driveMinutes: null, hourlyRateCents: null }]);
  });

  it('carries a missing rate through rather than guessing one', () => {
    // A new hire nobody has set a rate for. Substituting a colleague's rate, or
    // an average, would produce a confident number that is not true of anybody.
    const crew = crewLabour({
      clocked: [{ userId: 'newHire', minutes: 90 }],
      assignedUserId: 'sam',
      jobWorkedMinutes: 90,
      driveMinutes: null,
      rateFor,
    });

    expect(crew[0]!.hourlyRateCents).toBeNull();
  });
});
