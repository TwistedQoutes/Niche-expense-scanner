import { z } from 'zod';

import { CATEGORY_IDS } from '@/lib/categories/taxonomy';
import { MAX_AMOUNT_CENTS } from '@/lib/money';

/**
 * Every request body is validated here before it reaches the database.
 *
 * The schemas double as the source of truth for the client-side forms, so an
 * error message only has to be written once and cannot drift between the two.
 */

export const PASSWORD_MIN_LENGTH = 10;

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .max(254, 'That email address is too long.')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'));

/**
 * Length over composition rules: a 10-character minimum with an upper bound
 * (bcrypt silently truncates at 72 bytes, so anything longer is a false sense
 * of security) beats forcing a symbol and a digit.
 */
const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(72, 'Passwords are limited to 72 characters.');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  studioName: z.string().trim().max(120, 'That name is too long.').optional().or(z.literal('')),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: rejecting a short password at login would tell an
  // attacker about the policy and leaks nothing useful to a legitimate user.
  password: z.string().min(1, 'Enter your password.').max(200),
});

const categorySchema = z.enum(CATEGORY_IDS);

const amountCentsSchema = z
  .number()
  .int('Amounts must be a whole number of cents.')
  .positive('Enter an amount greater than zero.')
  .max(MAX_AMOUNT_CENTS, 'That amount looks too large — check the decimal point.');

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker to choose a date.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'That date is not valid.')
  .refine((value) => {
    // A receipt from the future is a typo; one day of slack covers time zones.
    const parsed = new Date(`${value}T00:00:00Z`).getTime();
    return parsed <= Date.now() + 36 * 60 * 60 * 1000;
  }, 'That date is in the future.');

export const createExpenseSchema = z.object({
  merchant: z.string().trim().min(1, 'Who was this paid to?').max(120, 'That name is too long.'),
  amountCents: amountCentsSchema,
  taxCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS).nullable().optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code.')
    .default('USD'),
  spentAt: dateOnlySchema,
  category: categorySchema,
  categoryConfidence: z.number().min(0).max(1).default(0),
  categorySource: z.enum(['auto', 'manual']).default('auto'),
  notes: z.string().trim().max(500, 'Notes are limited to 500 characters.').nullable().optional(),
  /** Full OCR text, kept for re-parsing. Capped so a giant paste cannot bloat a row. */
  rawText: z.string().max(20_000).nullable().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Nothing to update.',
);

export const parseReceiptSchema = z.object({
  rawText: z
    .string()
    .min(1, 'No text was recognised in that image.')
    .max(20_000, 'That receipt is unexpectedly long.'),
});

export const monthQuerySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must look like 2026-09.');

export const listExpensesQuerySchema = z.object({
  month: monthQuerySchema.optional(),
  category: categorySchema.optional(),
  search: z.string().trim().max(120).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
