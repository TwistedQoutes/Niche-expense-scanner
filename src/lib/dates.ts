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

// ─────────────────────────────────────────────────────────────────────────────
// Wall-clock time in a business's own timezone
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The offset, in minutes, that `timeZone` is ahead of UTC at a given instant.
 *
 * Derived from the runtime's own IANA database by asking what the wall clock in
 * that zone reads at that instant, rather than from a table we would have to
 * maintain. `America/New_York` in July is -240; in January, -300.
 */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  /*
   * `hour12: false` renders midnight as 24 in some ICU versions, which would
   * otherwise land this a day out.
   */
  const hour = field('hour') % 24;

  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    hour,
    field('minute'),
    field('second'),
  );

  // Whole minutes: every current zone is a whole number of minutes from UTC, and
  // rounding keeps the arithmetic below exact.
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** A wall-clock reading, with no offset of its own. */
export type WallClock = {
  year: number;
  /** 1–12, not the 0–11 that `Date` uses. */
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/**
 * The instant at which a business's clock reads this wall time.
 *
 * The whole reason this function exists: a crew's "Tuesday 9am" is a wall-clock
 * time in the business's own timezone, and `new Date('2026-03-10T09:00')` is
 * whatever the *server's* zone says — in a serverless deployment, UTC. Booking a
 * job that way puts a 9am visit on the calendar at 4am local, and the crew finds
 * out on the day.
 *
 * The offset cannot simply be looked up, because which offset applies depends on
 * the instant we are trying to compute. So: guess using the offset at the naive
 * instant, then re-check the offset at the answer and correct once if the guess
 * straddled a transition. A second correction is never needed — transitions are
 * hours apart and offsets change by at most a couple of hours.
 *
 * Two edge cases have no honest answer, and both are resolved rather than thrown:
 *
 *  - **The spring-forward gap.** 2:30am does not exist on the morning the clocks
 *    go forward. The result is the instant the clock jumps to (3:30am local),
 *    which is what a person means when they book "half past two" on that day.
 *  - **The autumn-back overlap.** 1:30am happens twice. The *first* one is
 *    returned, matching every calendar application and meaning the earlier of two
 *    equally valid readings.
 */
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);

  /** The instant this wall time would be, if `at`'s offset were the right one. */
  const candidateFrom = (at: number) => naive - zoneOffsetMinutes(new Date(at), timeZone) * 60_000;

  const first = candidateFrom(naive);
  const second = candidateFrom(first);

  /*
   * A candidate is a real reading only if it survives its own offset: the zone
   * must actually be at that offset at that instant. Testing this rather than
   * trusting the second pass is what separates the two edge cases below, which
   * otherwise look identical from here.
   */
  const consistent = [first, second].filter((candidate) => candidateFrom(candidate) === candidate);

  /*
   * The autumn overlap: both candidates can be real, an hour apart. The earlier
   * one is returned — every calendar application does the same, and it keeps the
   * answer stable rather than depending on which side of the transition the first
   * guess happened to land.
   */
  if (consistent.length > 0) return new Date(Math.min(...consistent));

  /*
   * Neither is real, so this wall time does not exist: the spring-forward gap.
   * The later candidate is the instant the clock jumps to — 2:30am becomes 3:30am,
   * which is what a person booking "half past two" that morning means. Taking the
   * earlier one would move the job an hour *backwards*, before the time they
   * asked for.
   */
  return new Date(Math.max(first, second));
}

/** What a business's clock reads at a given instant. */
export function instantToWallClock(instant: Date, timeZone: string): WallClock {
  const shifted = new Date(instant.getTime() + zoneOffsetMinutes(instant, timeZone) * 60_000);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * Parses the pair of values an `<input type="date">` and `<input type="time">`
 * produce into the instant the business means by them.
 *
 * Returns null rather than a wrong date for anything malformed, including the
 * dates `Date` would silently roll over (2026-02-31 → 2 March).
 */
export function parseLocalDateTime(
  dateValue: string,
  timeValue: string,
  timeZone: string,
): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  const time = /^(\d{2}):(\d{2})$/.exec(timeValue.trim());
  if (!day || !time) return null;

  const [, year, month, date] = day as unknown as [string, string, string, string];
  const [, hour, minute] = time as unknown as [string, string, string];

  const wall: WallClock = {
    year: Number(year),
    month: Number(month),
    day: Number(date),
    hour: Number(hour),
    minute: Number(minute),
  };

  if (wall.month < 1 || wall.month > 12) return null;
  if (wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59) return null;

  // Rejects 31 February rather than letting Date.UTC roll it into March.
  const probe = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  if (probe.getUTCMonth() !== wall.month - 1 || probe.getUTCDate() !== wall.day) return null;

  if (!isValidTimeZone(timeZone)) return null;

  return wallClockToInstant(wall, timeZone);
}

/** `YYYY-MM-DD` as the business's calendar reads it, for a date input's value. */
export function toLocalDateValue(instant: Date, timeZone: string): string {
  const wall = instantToWallClock(instant, timeZone);
  return [
    String(wall.year).padStart(4, '0'),
    String(wall.month).padStart(2, '0'),
    String(wall.day).padStart(2, '0'),
  ].join('-');
}

/** `HH:MM` in the business's timezone, for a time input's value. */
export function toLocalTimeValue(instant: Date, timeZone: string): string {
  const wall = instantToWallClock(instant, timeZone);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

/**
 * Half-open `[start, end)` covering one of the business's calendar days.
 *
 * Not 24 hours: the day the clocks change is 23 or 25 hours long, and a fixed
 * span would drop an hour of appointments from one end of it.
 */
export function localDayRange(
  dateValue: string,
  timeZone: string,
): { start: Date; end: Date } | null {
  const start = parseLocalDateTime(dateValue, '00:00', timeZone);
  if (!start) return null;

  const wall = instantToWallClock(start, timeZone);
  const nextDay = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1));

  const end = wallClockToInstant(
    {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
      hour: 0,
      minute: 0,
    },
    timeZone,
  );

  return { start, end };
}

/** The `YYYY-MM-DD` of each day in a week, starting Monday. */
export function localWeekDays(anchorDateValue: string, timeZone: string): string[] | null {
  const anchor = parseLocalDateTime(anchorDateValue, '12:00', timeZone);
  if (!anchor) return null;

  const wall = instantToWallClock(anchor, timeZone);
  const asUtc = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));

  // getUTCDay: 0 is Sunday. A service business's week starts Monday, and Sunday
  // belongs to the week it ends rather than the one it starts.
  const mondayOffset = (asUtc.getUTCDay() + 6) % 7;
  const monday = new Date(asUtc.getTime() - mondayOffset * 86_400_000);

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday.getTime() + index * 86_400_000);
    return day.toISOString().slice(0, 10);
  });
}

/** "9:00 AM" — the time shown on a calendar block. */
export function formatTimeLabel(date: Date, timeZone = 'UTC', locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(
    date,
  );
}

/** "Tue 10 Mar" — a calendar column heading. */
export function formatDayHeading(dateValue: string, locale = 'en-US'): string {
  const parsed = parseDateOnly(dateValue);
  if (!parsed) return dateValue;

  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}
