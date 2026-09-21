import { describe, expect, it } from 'vitest';

import {
  describeProximity,
  feetBetween,
  formatDistance,
  isPlausiblePoint,
  metresBetween,
} from '@/lib/geo/distance';

/**
 * What a phone knows, and what it only appears to know.
 *
 * These tests are about one asymmetry. If this code says "at the property" when
 * somebody was not, an owner is mildly misinformed. If it says "900 feet away"
 * when the phone had no idea where it was, an employee gets accused of skipping
 * a job they did. The two mistakes are not equal, and the behaviour here is
 * deliberately tilted against the second one.
 */

// A house in Austin, and points measured from it.
const HOUSE = { latitude: 30.2672, longitude: -97.7431 };

describe('distance between two points', () => {
  it('is zero for the same place', () => {
    expect(metresBetween(HOUSE, HOUSE)).toBe(0);
  });

  it('matches a known distance', () => {
    // Austin to Houston, about 235 km on the great circle.
    const houston = { latitude: 29.7604, longitude: -95.3698 };
    const km = metresBetween(HOUSE, houston) / 1000;

    expect(km).toBeGreaterThan(230);
    expect(km).toBeLessThan(240);
  });

  it('is symmetric', () => {
    const other = { latitude: 30.28, longitude: -97.75 };

    expect(metresBetween(HOUSE, other)).toBeCloseTo(metresBetween(other, HOUSE), 6);
  });

  it('converts to feet', () => {
    // A tenth of a degree of latitude is about 11.1 km, or 36,000 feet.
    const north = { latitude: 30.3672, longitude: -97.7431 };

    expect(feetBetween(HOUSE, north)).toBeGreaterThan(36_000);
    expect(feetBetween(HOUSE, north)).toBeLessThan(36_700);
  });
});

describe('coordinates worth storing', () => {
  it('accepts a real place', () => {
    expect(isPlausiblePoint(HOUSE)).toBe(true);
  });

  it('rejects Null Island, where a phone with no fix puts you', () => {
    // A real spot in the Gulf of Guinea and a plausible one for nobody mowing a
    // lawn. Stored as a pin it would place every crew member 4,000 miles out to
    // sea, which no screen downstream would have any way to disbelieve.
    expect(isPlausiblePoint({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it.each([
    ['off the top of the planet', { latitude: 91, longitude: 0 }],
    ['past the date line', { latitude: 30, longitude: 181 }],
    ['not a number', { latitude: Number.NaN, longitude: 0 }],
    ['infinite', { latitude: Number.POSITIVE_INFINITY, longitude: 0 }],
    ['missing', { latitude: null, longitude: null }],
    ['half a coordinate', { latitude: 30.26, longitude: null }],
  ])('rejects one that is %s', (_label, point) => {
    expect(isPlausiblePoint(point)).toBe(false);
  });
});

describe('what can honestly be said about where somebody was', () => {
  /** A point roughly `feet` north of the house. */
  const northOf = (feet: number) => ({
    latitude: HOUSE.latitude + feet / 364_000,
    longitude: HOUSE.longitude,
  });

  it('says they were at the property when the pin is on it', () => {
    const verdict = describeProximity({
      pin: { ...northOf(50), accuracyMetres: 8 },
      property: HOUSE,
    });

    expect(verdict.kind).toBe('at_property');
  });

  it('still says at the property from the far end of a big lot', () => {
    /*
     * The property's coordinate is the centre of a parcel, and the crew are
     * wherever the work is — the back garden, the truck at the kerb. A tolerance
     * tight enough to exclude that would mark honest crews absent, and this
     * feature failing in that direction is worse than it not existing.
     */
    const verdict = describeProximity({
      pin: { ...northOf(400), accuracyMetres: 10 },
      property: HOUSE,
    });

    expect(verdict.kind).toBe('at_property');
  });

  it('reports the distance when the pin is genuinely elsewhere', () => {
    const verdict = describeProximity({
      pin: { ...northOf(3_000), accuracyMetres: 10 },
      property: HOUSE,
    });

    expect(verdict.kind).toBe('away');
    if (verdict.kind === 'away') expect(Math.round(verdict.feet / 100)).toBe(30);
  });

  it('refuses to place a fix the phone was not sure about', () => {
    /*
     * The test this file exists for. Half a mile from the house, but the device
     * reported a 1,200-metre radius — it is saying "somewhere in this town".
     * Without this case that reads as "not at the property", which is a thing an
     * owner might act on and the data does not support.
     */
    const verdict = describeProximity({
      pin: { ...northOf(2_600), accuracyMetres: 1_200 },
      property: HOUSE,
    });

    expect(verdict.kind).toBe('too_vague');
  });

  it('gives the benefit of a middling fix to the crew', () => {
    // 700 feet out with a 100-metre radius could be a fix at the house. The cost
    // of a false "away" is an accusation; the cost of a false "at property" is a
    // slightly generous timesheet.
    const verdict = describeProximity({
      pin: { ...northOf(700), accuracyMetres: 100 },
      property: HOUSE,
    });

    expect(verdict.kind).toBe('at_property');
  });

  it('knows nothing when there is no pin', () => {
    expect(
      describeProximity({
        pin: { latitude: null, longitude: null, accuracyMetres: null },
        property: HOUSE,
      }).kind,
    ).toBe('unknown');
  });

  it('knows nothing when the property has never been geocoded', () => {
    // Common: a customer typed an address and nothing ever turned it into
    // coordinates. There is no comparison to make, and inventing one would be
    // worse than the blank.
    expect(
      describeProximity({
        pin: { ...northOf(50), accuracyMetres: 8 },
        property: { latitude: null, longitude: null },
      }).kind,
    ).toBe('unknown');
  });
});

describe('saying a distance out loud', () => {
  it.each([
    [42, '40 ft'],
    [860, '860 ft'],
    [5_280, '1.0 mi'],
    [79_200, '15 mi'],
  ])('renders %s feet as %s', (feet, expected) => {
    expect(formatDistance(feet)).toBe(expected);
  });

  it('does not offer false precision on short distances', () => {
    // Nobody needs to know it was 47 feet rather than 50, and the extra digit
    // implies the phone was that sure.
    expect(formatDistance(47)).toBe('50 ft');
  });
});
