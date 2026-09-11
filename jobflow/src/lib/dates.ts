/**
 * Time handling.
 *
 * Two different kinds of time live in this app and they must not be confused:
 *
 *  - **Instants** — when a quote was sent, when a job started. Stored as UTC
 *    timestamps, displayed in the organization's timezone.
 *  - **Calendar days** — the day a job is scheduled for. A crew's "Tuesday
 *    9am" is a wall-clock time in the business's own timezone; storing it as a
 *    naive local instant is how a calendar shifts by an hour the first time it
 *    crosses a daylight-saving boundary.
 *
 * Everything here is explicit about which one it is dealing with.
 */

/** `YYYY-MM` — the month key used by analytics buckets and usage counters. */
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

/**
 * The first instant of the current UTC month.
 *
 * This is the `period` key every Usage counter is stamped with, so a plan limit
 * means "per calendar month" and resets on its own without a scheduled job.
 */
export function currentUsagePeriod(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Half-open range `[start, end)` covering the given month, in UTC. */
export function monthRange(monthKey: MonthKey): { start: Date; end: Date } {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/** Half-open range `[start, end)` covering one UTC day. */
export function dayRange(date: Date): { start: Date; end: Date } {
  const start = toUtcMidnight(date);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/** Whole days from `from` to `to`, negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((toUtcMidnight(to).getTime() - toUtcMidnight(from).getTime()) / 86_400_000);
}

export function isPast(date: Date, now: Date = new Date()): boolean {
  return date.getTime() < now.getTime();
}

export function formatMonthLabel(monthKey: MonthKey, locale = 'en-US'): string {
  const { start } = monthRange(monthKey);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(start);
}

/** Short month label for chart axes: "Sep". */
export function formatMonthShort(monthKey: MonthKey, locale = 'en-US'): string {
  const { start } = monthRange(monthKey);
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(start);
}

export function formatDateLabel(date: Date, timeZone = 'UTC', locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/** "Tue 12 Sep, 9:00 AM" — the calendar and appointment list format. */
export function formatDateTimeLabel(date: Date, timeZone = 'UTC', locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/**
 * "3 days ago", "in 2 hours". Used on lead timelines, where the exact instant
 * matters less than how stale the last contact is.
 */
export function formatRelative(date: Date, now: Date = new Date(), locale = 'en-US'): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const seconds = (date.getTime() - now.getTime()) / 1000;

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }

  return formatter.format(Math.round(seconds), 'second');
}

/** The last `count` months, oldest first — the x-axis of every trend chart. */
export function recentMonthKeys(count = 12, now: Date = new Date()): MonthKey[] {
  const keys: MonthKey[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    keys.push(toMonthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))));
  }
  return keys;
}

/**
 * Validates an IANA timezone name against the runtime's own database.
 *
 * A bad value here is not cosmetic: it would throw inside `Intl.DateTimeFormat`
 * every time a calendar rendered, taking the page down rather than showing the
 * wrong hour.
 */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
