import { LeadSource, LeadStatus, Urgency } from '@prisma/client';
import { z } from 'zod';

import {
  centsSchema,
  idSchema,
  multiLineText,
  optionalEmailSchema,
  optionalPhoneSchema,
  postalCodeSchema,
  singleLineText,
} from '@/lib/validation/common';

/**
 * Lead schemas.
 *
 * The shape is deliberately forgiving about *contact* details and strict about
 * everything else. A lead often arrives as a name and half a phone number
 * shouted over a mower, and a form that refuses to save it loses the lead —
 * which is the one outcome this whole product exists to prevent. So only a
 * first name is required, and the rest can be filled in later.
 */

export const leadStatusSchema = z.enum(LeadStatus);
export const leadSourceSchema = z.enum(LeadSource);
export const urgencySchema = z.enum(Urgency);

const leadFields = {
  firstName: singleLineText(80, 'That name is too long.').pipe(
    z.string().min(1, 'Who is this lead?'),
  ),
  lastName: singleLineText(80, 'That name is too long.')
    .optional()
    .transform((value) => (value ? value : null)),
  email: optionalEmailSchema.optional(),
  phone: optionalPhoneSchema.optional(),

  addressLine1: singleLineText(160, 'That address is too long.')
    .optional()
    .transform((value) => (value ? value : null)),
  city: singleLineText(80).optional().transform((value) => (value ? value : null)),
  state: singleLineText(40).optional().transform((value) => (value ? value : null)),
  postalCode: postalCodeSchema.optional().transform((value) => (value ? value : null)),

  source: leadSourceSchema.optional(),
  serviceRequested: singleLineText(120, 'That service name is too long.')
    .optional()
    .transform((value) => (value ? value : null)),
  description: multiLineText(2000, 'That description is too long.')
    .optional()
    .transform((value) => (value ? value : null)),

  estimatedValueCents: centsSchema.nullable().optional(),
  notes: multiLineText(2000, 'Notes are limited to 2000 characters.')
    .optional()
    .transform((value) => (value ? value : null)),

  nextFollowUpAt: z.iso.datetime({ offset: true }).nullable().optional(),
};

export const createLeadSchema = z
  .object({
    ...leadFields,
    status: leadStatusSchema.optional(),
    customerId: idSchema.nullable().optional(),
    propertyId: idSchema.nullable().optional(),
  })
  .refine(
    (value) => Boolean(value.email || value.phone),
    {
      // Not a bureaucratic requirement: a lead with no way to reach them cannot
      // be followed up, quoted or won, so it is not a lead — it is a note.
      message: 'Add an email or a phone number so this lead can be contacted.',
      path: ['phone'],
    },
  );

export const updateLeadSchema = z
  .object({
    ...leadFields,
    status: leadStatusSchema.optional(),
    customerId: idSchema.nullable().optional(),
    propertyId: idSchema.nullable().optional(),
    lostReason: singleLineText(200)
      .optional()
      .transform((value) => (value ? value : null)),
    lastContactedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

/**
 * Moving a card on the pipeline board.
 *
 * `beforeId` and `afterId` are the cards it was dropped between, rather than a
 * numeric position. The client knows what the user dropped it between; it does
 * not know what the other positions are, and asking it to compute one would put
 * the ordering invariant in the least trustworthy place.
 */
export const moveLeadSchema = z.object({
  status: leadStatusSchema,
  /** The card now directly above it, if any. */
  afterId: idSchema.nullable().optional(),
  /** The card now directly below it, if any. */
  beforeId: idSchema.nullable().optional(),
});

export const listLeadsQuerySchema = z.object({
  status: leadStatusSchema.optional(),
  source: leadSourceSchema.optional(),
  search: singleLineText(120).optional(),
  /** Only leads scored at or above this. Used by the "hot leads" filter. */
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Converting a qualified lead into a customer record. */
export const convertLeadSchema = z.object({
  /** Attach to an existing customer instead of creating one. */
  customerId: idSchema.nullable().optional(),
  /** Also create a property from the lead's address. */
  createProperty: z.boolean().default(true),
});

export const addLeadNoteSchema = z.object({
  note: multiLineText(2000, 'Notes are limited to 2000 characters.').pipe(
    z.string().min(1, 'Write something first.'),
  ),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type MoveLeadInput = z.infer<typeof moveLeadSchema>;
