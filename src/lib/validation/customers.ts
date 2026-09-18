import { z } from 'zod';

import {
  idSchema,
  multiLineText,
  optionalEmailSchema,
  optionalPhoneSchema,
  postalCodeSchema,
  singleLineText,
} from '@/lib/validation/common';

const customerFields = {
  firstName: singleLineText(80, 'That name is too long.').pipe(
    z.string().min(1, 'What is the customer called?'),
  ),
  lastName: singleLineText(80, 'That name is too long.')
    .optional()
    .transform((value) => (value ? value : null)),
  email: optionalEmailSchema.optional(),
  phone: optionalPhoneSchema.optional(),
  company: singleLineText(120).optional().transform((value) => (value ? value : null)),

  addressLine1: singleLineText(160, 'That address is too long.')
    .optional()
    .transform((value) => (value ? value : null)),
  addressLine2: singleLineText(160).optional().transform((value) => (value ? value : null)),
  city: singleLineText(80).optional().transform((value) => (value ? value : null)),
  state: singleLineText(40).optional().transform((value) => (value ? value : null)),
  postalCode: postalCodeSchema.optional().transform((value) => (value ? value : null)),

  notes: multiLineText(2000, 'Notes are limited to 2000 characters.')
    .optional()
    .transform((value) => (value ? value : null)),

  /**
   * Free-form labels — "commercial", "weekly", "snowbird". Capped in count and
   * length because they are rendered in a list and an unbounded array is both a
   * layout problem and an easy way to bloat a row.
   */
  tags: z
    .array(singleLineText(24, 'Tags are limited to 24 characters.'))
    .max(12, 'Twelve tags is plenty.')
    .optional(),

  nextServiceDueAt: z.iso.datetime({ offset: true }).nullable().optional(),
};

export const createCustomerSchema = z.object(customerFields).refine(
  (value) => Boolean(value.email || value.phone),
  {
    // Same reasoning as leads: a customer with no contact route cannot be sent
    // a quote, a reminder or a review request.
    message: 'Add an email or a phone number so this customer can be contacted.',
    path: ['phone'],
  },
);

export const updateCustomerSchema = z
  .object(customerFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

export const listCustomersQuerySchema = z.object({
  search: singleLineText(120).optional(),
  tag: singleLineText(24).optional(),
  /** Customers whose next service is due on or before now. */
  dueOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
