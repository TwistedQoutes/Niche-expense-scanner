import { QuoteStatus } from '@prisma/client';
import { z } from 'zod';

import {
  centsSchema,
  idSchema,
  multiLineText,
  singleLineText,
} from '@/lib/validation/common';
import { calculateQuoteSchema } from '@/lib/validation/services';

/** How long a quote stays open by default. */
export const DEFAULT_QUOTE_VALID_DAYS = 30;

const quoteItemSchema = z.object({
  serviceId: idSchema.nullable().optional(),
  name: singleLineText(160, 'That line name is too long.').pipe(
    z.string().min(1, 'Give the line a name.'),
  ),
  description: multiLineText(500).optional().transform((value) => (value ? value : null)),
  /** Thousandths of a unit, so "1.5 hours" needs no float. */
  quantityMilli: z
    .number()
    .int('Quantities are in thousandths — 1500 for 1.5.')
    .min(1, 'A line needs a quantity.')
    .max(1_000_000)
    .default(1000),
  unitPriceCents: centsSchema.default(0),
  taxable: z.boolean().default(false),
  /** An add-on the customer can decline without rejecting the whole quote. */
  optional: z.boolean().default(false),
});

export const createQuoteSchema = z.object({
  customerId: idSchema.nullable().optional(),
  leadId: idSchema.nullable().optional(),
  propertyId: idSchema.nullable().optional(),

  title: singleLineText(160, 'That title is too long.')
    .optional()
    .transform((value) => (value ? value : null)),
  /** What the customer reads about the work. */
  summary: multiLineText(4000, 'That summary is too long.')
    .optional()
    .transform((value) => (value ? value : null)),
  terms: multiLineText(4000, 'Those terms are too long.')
    .optional()
    .transform((value) => (value ? value : null)),

  /** Days from sending until it expires. */
  validForDays: z
    .number()
    .int()
    .min(1, 'A quote has to be open for at least a day.')
    .max(365, 'A year is too long to hold a price.')
    .default(DEFAULT_QUOTE_VALID_DAYS),

  /**
   * The pricing inputs. The server recalculates from these rather than trusting
   * a total from the client — a price posted straight from a browser is a price
   * anyone can choose.
   */
  pricing: calculateQuoteSchema,

  /** Extra lines beyond the priced service. */
  items: z.array(quoteItemSchema).max(40, 'Forty lines is plenty.').optional(),
});

export const updateQuoteSchema = z
  .object({
    title: singleLineText(160).nullable(),
    summary: multiLineText(4000).nullable(),
    terms: multiLineText(4000).nullable(),
    validForDays: z.number().int().min(1).max(365),
    pricing: calculateQuoteSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

export const listQuotesQuerySchema = z.object({
  status: z.enum(QuoteStatus).optional(),
  customerId: idSchema.optional(),
  search: singleLineText(120).optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * What a customer can do on a public quote page.
 *
 * `note` is only meaningful for "changes", but it is accepted on any response
 * because someone declining often explains why, and that reason is worth more
 * to the business than a tidy schema.
 */
export const respondToQuoteSchema = z.object({
  action: z.enum(['accept', 'decline', 'changes']),
  note: multiLineText(2000, 'Please keep that under 2000 characters.')
    .optional()
    .transform((value) => (value ? value : null)),
});

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type QuoteItemInput = z.infer<typeof quoteItemSchema>;
export type RespondToQuoteInput = z.infer<typeof respondToQuoteSchema>;
