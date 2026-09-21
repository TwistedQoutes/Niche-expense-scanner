import { z } from 'zod';

import { isPlausiblePoint } from '@/lib/geo/distance';
import { multiLineText } from '@/lib/validation/common';

/**
 * What a phone is allowed to tell the server about where it is.
 *
 * Every field here is optional, and that is the contract rather than an
 * oversight: a clock-in with no location at all is a valid clock-in. The browser
 * hands back a position or a reason it could not, and both are accepted — see
 * the note on the TimeEntry model.
 *
 * The bounds are not paranoia about a hostile client so much as about a confused
 * one. A device with no fix can report latitude 0, longitude 0, accuracy
 * 20,000,000; storing that as a pin would place a crew member in the Atlantic
 * with a radius the size of the planet, and every screen downstream would have
 * to know to disbelieve it. Better to refuse the nonsense once, here.
 */

/** Why there is no pin. A closed set, because it is rendered as a sentence. */
export const LOCATION_NOTES = [
  /** The person said no, or said no once and the browser remembered. */
  'denied',
  /** The device tried and could not get a fix — indoors, no signal. */
  'unavailable',
  /** It was still trying when we stopped waiting. */
  'timeout',
  /** An old browser with no geolocation at all. */
  'unsupported',
  /**
   * Served over plain HTTP, where browsers refuse geolocation outright. Worth
   * its own value because it is the one cause that is our fault, not the
   * phone's, and it should look like a deployment problem rather than a crew
   * member declining.
   */
  'insecure',
] as const;

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /*
   * Accuracy is a radius in metres. Rounded to an integer because the decimals
   * are false precision, and capped at 100km because anything vaguer is the
   * device saying "no idea" in a way that would only ever be misread.
   */
  accuracyMetres: z.number().min(0).max(100_000).transform(Math.round).optional(),
  locationNote: z.enum(LOCATION_NOTES).optional(),
});

/*
 * Latitude without longitude is half a coordinate, which is not a place. Caught
 * here rather than left for the repository to find, so the database never holds
 * a row that cannot be plotted.
 */
const coordinatesTogether = <T extends { latitude?: number; longitude?: number }>(value: T) =>
  (value.latitude === undefined) === (value.longitude === undefined);

const COORDINATE_PAIR_MESSAGE = 'A location needs both a latitude and a longitude.';

/*
 * And it has to be a place somebody could stand.
 *
 * `isPlausiblePoint` is the same guard the distance maths uses, borrowed rather
 * than restated: the pair (0, 0) is inside every range above and is where a
 * device with no fix puts you, so without this the database would collect pins
 * in the Gulf of Guinea that every screen downstream has to remember to
 * disbelieve. Refusing it once here means nothing later has to.
 */
const plausibleLocation = <T extends { latitude?: number; longitude?: number }>(value: T) =>
  value.latitude === undefined ||
  isPlausiblePoint({ latitude: value.latitude, longitude: value.longitude });

const PLAUSIBLE_MESSAGE = 'That is not a location on earth.';

export const clockInSchema = locationSchema
  .extend({
    note: multiLineText(500, 'Keep the note under 500 characters.').optional(),
  })
  .refine(coordinatesTogether, { message: COORDINATE_PAIR_MESSAGE, path: ['longitude'] })
  .refine(plausibleLocation, { message: PLAUSIBLE_MESSAGE, path: ['latitude'] });

export const clockOutSchema = locationSchema
  .extend({
    note: multiLineText(500, 'Keep the note under 500 characters.').optional(),
  })
  .refine(coordinatesTogether, { message: COORDINATE_PAIR_MESSAGE, path: ['longitude'] })
  .refine(plausibleLocation, { message: PLAUSIBLE_MESSAGE, path: ['latitude'] });

export type ClockInInput = z.infer<typeof clockInSchema>;
export type ClockOutInput = z.infer<typeof clockOutSchema>;
