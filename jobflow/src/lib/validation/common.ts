import { z } from 'zod';

/**
 * Shared building blocks for every request schema.
 *
 * The schemas double as the source of truth for the client-side forms, so an
 * error message is written once and cannot drift between the two.
 */

/**
 * Control characters that must never reach the database.
 *
 * Postgres rejects NUL (0x00) inside a text value outright, so an unsanitised
 * string containing one does not fail validation — it crashes the query and the
 * request 500s. Any client can trigger that with a single byte, which makes it
 * both a robustness bug and a cheap way to fill someone's error log.
 *
 * Tab, newline and carriage return are kept: job notes are legitimately
 * multi-line.
 */
// Written as escapes, not literal bytes: a source file containing a real NUL
// is treated as binary by git and grep, so it stops producing diffs on review.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Line breaks and control characters removed: for single-line fields. */
export function singleLineText(max: number, message?: string) {
  return z
    .string()
    .transform((value) => value.replace(CONTROL_CHARACTERS, '').replace(/[\r\n\t]+/g, ' ').trim())
    .pipe(z.string().max(max, message));
}

/** Control characters removed, line breaks preserved: for notes and descriptions. */
export function multiLineText(max: number, message?: string) {
  return z
    .string()
    .transform((value) => value.replace(CONTROL_CHARACTERS, '').trim())
    .pipe(z.string().max(max, message));
}

/**
 * A database id, as it comes back in a path parameter or a pagination cursor.
 *
 * Shape-checked rather than looked up: an id that is merely unknown is harmless
 * (the query returns nothing), but one containing a NUL byte reaches Postgres
 * and crashes the query.
 */
export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'That identifier is not valid.');

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .max(254, 'That email address is too long.')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'));

export const optionalEmailSchema = z
  .string()
  .trim()
  .max(254, 'That email address is too long.')
  .toLowerCase()
  .pipe(z.union([z.literal(''), z.email('Enter a valid email address.')]))
  .transform((value) => (value === '' ? null : value));

/**
 * Phone numbers are stored as typed, not normalised to E.164.
 *
 * Normalising needs a country, and guessing one silently mangles the number of
 * every customer outside it. What is enforced is that the value is plausibly a
 * phone number and short enough to store; Twilio does the authoritative parse
 * at send time, where a failure can be reported against a specific message.
 */
export const phoneSchema = z
  .string()
  .trim()
  .max(32, 'That phone number is too long.')
  .refine(
    (value) => value === '' || /^[+()\d][\d\s().+-]{5,31}$/.test(value),
    'Enter a valid phone number.',
  );

export const optionalPhoneSchema = phoneSchema.transform((value) => (value === '' ? null : value));

export const urlSchema = z
  .string()
  .trim()
  .max(2048, 'That link is too long.')
  .refine(
    (value) => value === '' || /^https?:\/\/\S+$/i.test(value),
    'Enter a full link starting with http:// or https://',
  )
  .transform((value) => (value === '' ? null : value));

/** Money, as whole cents. Never a float — see src/lib/money.ts. */
export const centsSchema = z
  .number()
  .int('Amounts must be a whole number of cents.')
  .min(0, 'Amounts cannot be negative.')
  .max(100_000_000, 'That amount looks too large — check the decimal point.');

/** A percentage in basis points: 3000 is 30%. */
export const bpsSchema = z
  .number()
  .int('Use basis points — 3000 for 30%.')
  .min(0, 'That cannot be negative.')
  /*
   * 99% is the ceiling, and it is inclusive. The message used to say "99% or
   * more is not a real price" while the rule accepted exactly 99% — a promise the
   * validation did not keep, and the kind of mismatch somebody eventually files a
   * bug about. The limit exists to keep `priceForMargin` away from dividing by
   * zero at 100%, not to police anybody's pricing.
   */
  .max(9_900, 'A margin has to be under 100%.');

export const dateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'That date is not valid.')
  .transform((value) => new Date(value));

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker to choose a date.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'That date is not valid.');

/** US-style postal code, kept loose enough for Canadian customers. */
export const postalCodeSchema = singleLineText(12, 'That postal code is too long.');

export const paginationSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
