/**
 * Whether two bookings collide.
 *
 * Intervals are half-open `[startsAt, endsAt)`, which is the only convention that
 * makes back-to-back jobs work: a 9–10 and a 10–11 slot do not overlap, and a
 * crew can be booked straight through the morning. Treating them as closed would
 * reject every sensible run of appointments as a double-booking.
 */

export type Interval = { startsAt: Date; endsAt: Date };

export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * A zero-length booking touches nothing under the rule above, so it would
 * silently never conflict. Callers reject these at validation; this exists so the
 * reason is written down next to the rule it depends on.
 */
export function isEmpty(interval: Interval): boolean {
  return interval.endsAt <= interval.startsAt;
}

export function minutesBetween(interval: Interval): number {
  return Math.round((interval.endsAt.getTime() - interval.startsAt.getTime()) / 60_000);
}
