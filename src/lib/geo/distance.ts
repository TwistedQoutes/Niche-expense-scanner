/**
 * How far apart two points on the earth are, and how much to believe it.
 *
 * Used for one question: when somebody tapped "clock in", were they at the
 * property? That question has a trap in it, and the trap is the whole reason
 * this file is longer than a haversine formula.
 *
 * A phone does not report where it is. It reports where it *thinks* it is,
 * together with a radius it is fairly confident about — 5 metres outdoors with a
 * clear sky, 2,000 metres indoors on a cell tower fix, and it does not always
 * know which one it is having. So "the pin is 140 feet from the property" means
 * nothing on its own. With an accuracy of 10 metres it means they were not at
 * the house. With an accuracy of 1,500 metres it means nothing at all, and
 * presenting it as evidence would be inventing certainty the hardware never
 * claimed.
 *
 * That matters more here than it would elsewhere, because the person being
 * measured is an employee and the reader is their boss. A number that looks like
 * proof and is not is how somebody gets accused of not turning up to a job they
 * did. So every distance comes out of this file carrying what is known about its
 * own reliability, and the honest answer — "this fix is too vague to say" — is a
 * first-class result rather than an edge case.
 */

export type Point = { latitude: number; longitude: number };

/** Mean earth radius, in metres. */
const EARTH_RADIUS_M = 6_371_008.8;

const METRES_PER_FOOT = 0.3048;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Whether a pair of coordinates could be a real place on earth. */
export function isPlausiblePoint(point: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
}): point is Point {
  const { latitude, longitude } = point;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;

  /*
   * Null Island, where a device that has no fix but will not admit it puts you.
   * It is a real location in the Gulf of Guinea and a plausible one for nobody
   * mowing a lawn, so it is rejected rather than stored as a pin that would place
   * every crew member 4,000 miles out to sea.
   */
  if (latitude === 0 && longitude === 0) return false;

  return true;
}

/**
 * Great-circle distance in metres.
 *
 * Haversine on a sphere. Good to a few metres over the distances that matter
 * here, which is far better than the fixes being compared.
 */
export function metresBetween(a: Point, b: Point): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function feetBetween(a: Point, b: Point): number {
  return metresBetween(a, b) / METRES_PER_FOOT;
}

/**
 * How near a fix has to be to count as "at the property".
 *
 * A lot said briefly: a house sits on a lot, the pin is taken from wherever the
 * phone is on that lot — the back garden, the truck at the kerb — and the
 * property's own coordinate is the centre of a parcel that may be an acre.
 * Anything tighter than this would mark honest crews as absent, and this feature
 * failing in that direction is worse than it not existing.
 */
const AT_PROPERTY_FEET = 500;

/**
 * Beyond which the fix is too vague to mean anything.
 *
 * Above this, the phone is telling you it might be anywhere within a quarter of
 * a mile, and a distance computed from it is not evidence of anything.
 */
const USELESS_ACCURACY_METRES = 400;

export type Proximity =
  | { kind: 'at_property'; feet: number }
  | { kind: 'away'; feet: number }
  /** A fix so vague that the distance means nothing. */
  | { kind: 'too_vague'; feet: number; accuracyMetres: number }
  /** No pin, or nothing to compare it against. */
  | { kind: 'unknown' };

/**
 * What can honestly be said about where somebody was.
 *
 * The `too_vague` case is the one that earns its keep. Without it a 1,200-metre
 * cell-tower fix 900 feet from the house reads as "not at the property", which
 * is a thing an owner might act on and the data does not support.
 */
export function describeProximity(input: {
  pin: { latitude: number | null; longitude: number | null; accuracyMetres: number | null };
  property: { latitude: number | null; longitude: number | null };
}): Proximity {
  if (!isPlausiblePoint(input.pin) || !isPlausiblePoint(input.property)) {
    return { kind: 'unknown' };
  }

  const feet = feetBetween(input.pin, input.property);
  const accuracy = input.pin.accuracyMetres;

  if (accuracy !== null && accuracy > USELESS_ACCURACY_METRES) {
    return { kind: 'too_vague', feet, accuracyMetres: accuracy };
  }

  /*
   * The accuracy radius counts in the crew's favour. A fix 600 feet out with a
   * 100-metre radius could genuinely be a fix at the house, so it is treated as
   * one: the cost of a false "away" is an accusation, and the cost of a false
   * "at property" is a slightly generous timesheet.
   */
  const slackFeet = accuracy === null ? 0 : accuracy / METRES_PER_FOOT;

  return feet - slackFeet <= AT_PROPERTY_FEET
    ? { kind: 'at_property', feet }
    : { kind: 'away', feet };
}

/** A distance said the way somebody would say it out loud. */
export function formatDistance(feet: number): string {
  if (feet < 1_000) return `${Math.round(feet / 10) * 10} ft`;

  const miles = feet / 5_280;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}
