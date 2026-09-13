import { z } from 'zod';

import { isValidTimeZone } from '@/lib/dates';
import {
  optionalEmailSchema,
  optionalPhoneSchema,
  postalCodeSchema,
  singleLineText,
  urlSchema,
} from '@/lib/validation/common';

/**
 * A link the product will send customers to.
 *
 * Stricter than `urlSchema`, because this value becomes the target of a redirect
 * that goes out in text messages to every customer of the business. Parsed rather
 * than pattern-matched, and checked for the things a regex over `\S+` lets
 * through:
 *
 *  - **Only http and https.** `javascript:` and `data:` URLs in an anchor a
 *    customer taps are script execution.
 *  - **No embedded credentials.** `https://google.com@evil.example` reads as
 *    Google to a person skimming the link and resolves to evil.example.
 *
 * The owner sets this themselves, so this is not primarily about a malicious
 * owner — it is about a mistyped or pasted-from-somewhere link, and about limiting
 * what a compromised admin session could turn the business's own review texts
 * into.
 */
export const reviewUrlSchema = z
  .string()
  .trim()
  .max(2048, 'That link is too long.')
  .superRefine((value, ctx) => {
    if (value === '') return;

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a full link, starting with https://',
      });
      return;
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only http and https links can be sent to customers.',
      });
      return;
    }

    if (parsed.username !== '' || parsed.password !== '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Remove the username and password from that link.',
      });
      return;
    }

    if (parsed.hostname === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That link has no website in it.' });
    }
  })
  .transform((value) => (value === '' ? null : value));

/**
 * Whether a stored link is still safe to redirect a customer to.
 *
 * Checked again at redirect time rather than trusted because it passed validation
 * once: a value can predate a rule, or be written by a migration or by hand. The
 * redirect is the moment it matters, so that is where it is enforced.
 */
export function isSafeRedirectTarget(value: string | null): boolean {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hostname !== ''
    );
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1, 'Choose a timezone.')
  .max(64)
  /*
   * Validated against the runtime's own IANA database. A bad value is not
   * cosmetic: it throws inside `Intl.DateTimeFormat` every time a calendar
   * renders, taking the page down rather than showing the wrong hour.
   */
  .refine(isValidTimeZone, 'That is not a timezone this server knows.');

export const updateOrganizationSchema = z
  .object({
    name: singleLineText(120, 'That business name is too long.').pipe(
      z.string().min(2, 'What is the business called?'),
    ),
    ownerName: singleLineText(120).pipe(z.string().min(1, 'What should we call you?')),
    email: optionalEmailSchema,
    phone: optionalPhoneSchema,
    website: urlSchema,
    /** Where a review request sends the customer. */
    reviewUrl: reviewUrlSchema,
    addressLine1: singleLineText(200),
    addressLine2: singleLineText(200),
    city: singleLineText(80),
    state: singleLineText(40),
    postalCode: postalCodeSchema,
    timezone: timeZoneSchema,
    serviceRadiusMiles: z
      .number()
      .int('Use a whole number of miles.')
      .min(1, 'At least a mile.')
      .max(500, 'Five hundred miles is not a service area.'),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to change.');

/** How long without work before a customer counts as lapsed. */
export const reactivationSettingsSchema = z.object({
  inactiveDays: z
    .number()
    .int('Use a whole number of days.')
    .min(7, 'A week is too soon to call somebody lapsed.')
    .max(365 * 2, 'Two years is the most this will look back.')
    .default(60),
});

export const listReviewRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'SENT', 'OPENED', 'CLICKED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
