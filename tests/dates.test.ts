import { describe, expect, it } from 'vitest';

import {
  currentMonthKey,
  formatMonthLabel,
  isMonthKey,
  monthRange,
  parseDateOnly,
  recentMonthKeys,
  toMonthKey,
} from '@/lib/dates';

describe('parseDateOnly', () => {
  it('parses a valid date to UTC midnight', () => {
    const parsed = parseDateOnly('2026-09-03');
    expect(parsed?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  it('rejects impossible dates rather than rolling them over', () => {
    // Plain `new Date` would silently turn this into 2026-03-03.
    expect(parseDateOnly('2026-02-31')).toBeNull();
    expect(parseDateOnly('2026-13-01')).toBeNull();
    expect(parseDateOnly('not-a-date')).toBeNull();
    expect(parseDateOnly('')).toBeNull();
  });
});

describe('isMonthKey', () => {
  it('accepts only YYYY-MM with a real month', () => {
    expect(isMonthKey('2026-09')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-9')).toBe(false);
    expect(isMonthKey(null)).toBe(false);
  });
});

describe('monthRange', () => {
  it('returns a half-open range so no expense is double-counted', () => {
    const { start, end } = monthRange('2026-09');
    expect(start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rolls the year over in December', () => {
    expect(monthRange('2026-12').end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('toMonthKey / currentMonthKey', () => {
  it('derives the month key in UTC', () => {
    expect(toMonthKey(new Date('2026-09-30T23:30:00Z'))).toBe('2026-09');
    expect(currentMonthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
});

describe('recentMonthKeys', () => {
  it('walks backwards across a year boundary', () => {
    expect(recentMonthKeys(3, new Date('2026-01-15T00:00:00Z'))).toEqual(['2026-01', '2025-12', '2025-11']);
  });
});

describe('formatMonthLabel', () => {
  it('renders a human month, unaffected by the server time zone', () => {
    expect(formatMonthLabel('2026-09')).toBe('September 2026');
  });
});
