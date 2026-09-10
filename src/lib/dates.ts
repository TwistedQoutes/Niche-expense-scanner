/**
 * Dates are stored as UTC midnight of the calendar day the money was spent.
 *
 * An expense belongs to a *day*, not an instant: storing a local timestamp
 * means a receipt scanned at 11pm can land in the wrong month once the server
 * and the artist are in different time zones, and monthly totals are the whole
 * point of the dashboard.
 */

/** `YYYY-MM` — the month key used by the dashboard filter and the export. */
export type MonthKey = string;

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && MONTH_KEY_PATTERN.test(value);
}

export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Parses a `YYYY-MM-DD` input value into UTC midnight, or null if invalid. */
export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day] = match as unknown as [string, string, string, string];
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  // Rejects impossible dates that Date would otherwise roll over (2026-02-31).
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return parsed;
}

/** `YYYY-MM-DD`, suitable for an `<input type="date">` value. */
export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toMonthKey(date: Date): MonthKey {
  return date.toISOString().slice(0, 7);
}

export function currentMonthKey(now: Date = new Date()): MonthKey {
  return toMonthKey(now);
}

/** Half-open range `[start, end)` covering the given month, in UTC. */
export function monthRange(monthKey: MonthKey): { start: Date; end: Date } {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export function formatMonthLabel(monthKey: MonthKey, locale = 'en-US'): string {
  const { start } = monthRange(monthKey);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
}

export function formatDateLabel(date: Date, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** The last `count` months, newest first — the dashboard's month selector. */
export function recentMonthKeys(count = 24, now: Date = new Date()): MonthKey[] {
  const keys: MonthKey[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    keys.push(toMonthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))));
  }
  return keys;
}
