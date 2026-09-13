import { describe, expect, it } from 'vitest';

import {
  formatTimeLabel,
  instantToWallClock,
  localDayRange,
  localWeekDays,
  parseLocalDateTime,
  toLocalDateValue,
  toLocalTimeValue,
  wallClockToInstant,
  zoneOffsetMinutes,
} from '@/lib/dates';

/**
 * A calendar that is an hour out is worse than no calendar: the crew turns up at
 * the wrong time and the customer is the one who notices. These are the cases
 * that make that happen.
 */

const NY = 'America/New_York';
const LONDON = 'Europe/London';
const PHOENIX = 'America/Phoenix'; // no daylight saving at all
const KATHMANDU = 'Asia/Kathmandu'; // +05:45, a non-hour offset

describe('zone offsets', () => {
  it('reads summer and winter offsets from the runtime database', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), NY)).toBe(-240);
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), NY)).toBe(-300);
  });

  it('handles a zone that does not observe daylight saving', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), PHOENIX)).toBe(-420);
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), PHOENIX)).toBe(-420);
  });

  it('handles an offset that is not a whole hour', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), KATHMANDU)).toBe(345);
  });

  it('gets midnight right', () => {
    // hour12: false renders midnight as 24 in some ICU builds, which would put
    // this a day out.
    expect(zoneOffsetMinutes(new Date('2026-07-15T04:00:00Z'), NY)).toBe(-240);
    expect(instantToWallClock(new Date('2026-07-15T04:00:00Z'), NY)).toEqual({
      year: 2026,
      month: 7,
      day: 15,
      hour: 0,
      minute: 0,
    });
  });
});

describe('a business booking its own wall-clock time', () => {
  it('books 9am local as 9am local, not 9am UTC', () => {
    // The bug this prevents: a 9am job landing at 4am local because the server
    // runs in UTC.
    const summer = wallClockToInstant({ year: 2026, month: 7, day: 15, hour: 9, minute: 0 }, NY);
    expect(summer.toISOString()).toBe('2026-07-15T13:00:00.000Z');

    const winter = wallClockToInstant({ year: 2026, month: 1, day: 15, hour: 9, minute: 0 }, NY);
    expect(winter.toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('round-trips every hour of a day across a DST boundary', () => {
    // 2026-03-08 is the US spring-forward date. 2am does not exist; every other
    // hour must survive a round trip exactly.
    for (const day of ['2026-03-07', '2026-03-08', '2026-03-09']) {
      for (let hour = 0; hour < 24; hour += 1) {
        const time = `${String(hour).padStart(2, '0')}:30`;
        const instant = parseLocalDateTime(day, time, NY);
        expect(instant).not.toBeNull();

        const skipped = day === '2026-03-08' && hour === 2;
        if (skipped) continue;

        expect(toLocalDateValue(instant!, NY)).toBe(day);
        expect(toLocalTimeValue(instant!, NY)).toBe(time);
      }
    }
  });

  it('resolves the hour that does not exist to the one the clock jumps to', () => {
    // 2:30am on 8 March 2026 in New York never happens.
    const instant = parseLocalDateTime('2026-03-08', '02:30', NY);

    expect(instant).not.toBeNull();
    expect(toLocalTimeValue(instant!, NY)).toBe('03:30');
    // Still on the intended day, which is what makes it a usable answer rather
    // than a silent day shift.
    expect(toLocalDateValue(instant!, NY)).toBe('2026-03-08');
  });

  it('resolves the hour that happens twice to the first of them', () => {
    // 1:30am on 1 November 2026 in New York happens at -04:00 and again at -05:00.
    const instant = parseLocalDateTime('2026-11-01', '01:30', NY);

    expect(instant).not.toBeNull();
    expect(instant!.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(toLocalTimeValue(instant!, NY)).toBe('01:30');
  });

  it('works for a zone on the other side of UTC', () => {
    const instant = parseLocalDateTime('2026-07-15', '09:00', LONDON);
    expect(instant!.toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });

  it('works for a non-hour offset', () => {
    const instant = parseLocalDateTime('2026-07-15', '09:00', KATHMANDU);
    expect(instant!.toISOString()).toBe('2026-07-15T03:15:00.000Z');
  });
});

describe('parsing what the form sends', () => {
  it('rejects a date that does not exist rather than rolling it over', () => {
    // Date.UTC would turn this into 3 March without complaining.
    expect(parseLocalDateTime('2026-02-31', '09:00', NY)).toBeNull();
    expect(parseLocalDateTime('2026-13-01', '09:00', NY)).toBeNull();
    expect(parseLocalDateTime('2026-00-10', '09:00', NY)).toBeNull();
  });

  it('rejects malformed values', () => {
    for (const bad of ['', '2026-3-8', '08/03/2026', 'today']) {
      expect(parseLocalDateTime(bad, '09:00', NY)).toBeNull();
    }
    for (const bad of ['', '9:00', '25:00', '09:60', 'noon']) {
      expect(parseLocalDateTime('2026-03-08', bad, NY)).toBeNull();
    }
  });

  it('rejects a timezone the runtime does not know', () => {
    // Letting this through would throw inside Intl on every calendar render,
    // taking the page down rather than showing the wrong hour.
    expect(parseLocalDateTime('2026-03-08', '09:00', 'Mars/Olympus_Mons')).toBeNull();
  });

  it('accepts a leap day in a leap year and refuses it otherwise', () => {
    expect(parseLocalDateTime('2028-02-29', '09:00', NY)).not.toBeNull();
    expect(parseLocalDateTime('2026-02-29', '09:00', NY)).toBeNull();
  });
});

describe('a business calendar day', () => {
  it('spans midnight to midnight in the business timezone', () => {
    const range = localDayRange('2026-07-15', NY);

    expect(range).not.toBeNull();
    expect(range!.start.toISOString()).toBe('2026-07-15T04:00:00.000Z');
    expect(range!.end.toISOString()).toBe('2026-07-16T04:00:00.000Z');
  });

  it('is 23 hours long on the day the clocks go forward', () => {
    // A fixed 24-hour window would include an hour of the next day, showing
    // tomorrow's first job on today's list.
    const range = localDayRange('2026-03-08', NY)!;
    const hours = (range.end.getTime() - range.start.getTime()) / 3_600_000;

    expect(hours).toBe(23);
  });

  it('is 25 hours long on the day they go back', () => {
    const range = localDayRange('2026-11-01', NY)!;
    const hours = (range.end.getTime() - range.start.getTime()) / 3_600_000;

    expect(hours).toBe(25);
  });

  it('covers a 9am appointment on that day and not the next', () => {
    const range = localDayRange('2026-03-08', NY)!;
    const appointment = parseLocalDateTime('2026-03-08', '09:00', NY)!;
    const tomorrow = parseLocalDateTime('2026-03-09', '00:30', NY)!;

    expect(appointment >= range.start && appointment < range.end).toBe(true);
    expect(tomorrow >= range.end).toBe(true);
  });

  it('refuses an invalid day', () => {
    expect(localDayRange('2026-02-31', NY)).toBeNull();
  });
});

describe('the week a calendar shows', () => {
  it('starts on Monday', () => {
    // 2026-09-12 is a Saturday.
    expect(localWeekDays('2026-09-12', NY)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
  });

  it('puts Sunday at the end of the week it finishes, not the start of the next', () => {
    // 2026-09-13 is a Sunday; it belongs with the week just gone.
    expect(localWeekDays('2026-09-13', NY)?.at(-1)).toBe('2026-09-13');
    expect(localWeekDays('2026-09-13', NY)?.at(0)).toBe('2026-09-07');
  });

  it('gives the same week for every day in it', () => {
    const monday = localWeekDays('2026-09-07', NY);

    for (const day of monday!) {
      expect(localWeekDays(day, NY)).toEqual(monday);
    }
  });

  it('crosses a month boundary without losing a day', () => {
    const week = localWeekDays('2026-10-01', NY);

    expect(week).toHaveLength(7);
    expect(week).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('spans a DST change without duplicating or dropping a day', () => {
    const week = localWeekDays('2026-03-08', NY)!;

    expect(new Set(week).size).toBe(7);
    expect(week).toContain('2026-03-08');
  });
});

describe('what the crew reads', () => {
  it('shows the time in the business timezone, not the server one', () => {
    const instant = new Date('2026-07-15T13:00:00Z');

    expect(formatTimeLabel(instant, NY)).toBe('9:00 AM');
    expect(formatTimeLabel(instant, LONDON)).toBe('2:00 PM');
  });
});
