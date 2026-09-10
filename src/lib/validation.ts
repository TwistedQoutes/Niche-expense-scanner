import { z } from 'zod';

import { CATEGORY_IDS } from '@/lib/categories/taxonomy';
import { MAX_AMOUNT_CENTS, centsToDecimalString } from '@/lib/money';

/** A receipt split more ways than this is noise rather than insight. */
export const MAX_EXPENSE_LINES = 12;

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

/** One category's share of a receipt. */
export const expenseLineSchema = z.object({
  label: z.string().trim().max(160, 'That description is too long.').nullable().optional(),
  amountCents: z
    .number()
    .int('Amounts must be a whole number of cents.')
    .positive('Each part must be more than zero.')
    .max(MAX_AMOUNT_CENTS, 'That amount looks too large — check the decimal point.'),
  category: categorySchema,
  categoryConfidence: z.number().min(0).max(1).default(0),
  categorySource: z.enum(['auto', 'manual']).default('auto'),
});

const linesSchema = z
  .array(expenseLineSchema)
  .min(1, 'An expense needs at least one category.')
  .max(MAX_EXPENSE_LINES, `An expense can be split at most ${MAX_EXPENSE_LINES} ways.`);

/**
 * No `.default()` here, deliberately.
 *
 * `z.object({...}).partial()` keeps a field's default and still applies it when
 * the key is absent, so a default on the shared field list leaks into every
 * partial update: `PATCH {merchant}` would arrive as
 * `{merchant, currency: 'USD'}` and quietly rewrite a GBP receipt to dollars.
 * The default belongs on the create schema alone, where an absent currency
 * genuinely means "assume USD".
 */
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code.');

const expenseFields = {
  merchant: z.string().trim().min(1, 'Who was this paid to?').max(120, 'That name is too long.'),
  amountCents: amountCentsSchema,
  taxCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS).nullable().optional(),
  currency: currencySchema,
  spentAt: dateOnlySchema,
  notes: z.string().trim().max(500, 'Notes are limited to 500 characters.').nullable().optional(),
  /** Full OCR text, kept for re-parsing. Capped so a giant paste cannot bloat a row. */
  rawText: z.string().max(20_000).nullable().optional(),
  lines: linesSchema,
};

/**
 * The invariant that makes a split trustworthy: the parts must add up to the
 * receipt total, to the cent.
 *
 * Without this the dashboard's month total and its category breakdown drift
 * apart, and the CSV export stops reconciling against the receipts it came
 * from — the kind of wrongness nobody notices until an accountant does.
 */
function attachSumInvariant<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, context) => {
    const candidate = value as { amountCents?: number; lines?: { amountCents: number }[] };
    if (candidate.amountCents === undefined || candidate.lines === undefined) return;

    const sum = candidate.lines.reduce((running, line) => running + line.amountCents, 0);
    if (sum === candidate.amountCents) return;

    const difference = candidate.amountCents - sum;
    context.addIssue({
      code: 'custom',
      path: ['lines'],
      message:
        difference > 0
          ? `The parts are ${centsToDecimalString(difference)} short of the total.`
          : `The parts exceed the total by ${centsToDecimalString(-difference)}.`,
    });
  });
}

export const createExpenseSchema = attachSumInvariant(
  z.object({ ...expenseFields, currency: currencySchema.default('USD') }),
);

/**
 * Updates are partial, but `amountCents` and `lines` move together: changing
 * either alone could break the invariant, so both must be sent to change either.
 */
export const updateExpenseSchema = attachSumInvariant(
  z
    .object(expenseFields)
    .partial()
    .refine((value) => Object.keys(value).length > 0, 'Nothing to update.')
    .refine(
      (value) => (value.lines === undefined) === (value.amountCents === undefined),
      { message: 'Send the total and its parts together.', path: ['lines'] },
    ),
);

export const updateSettingsSchema = z
  .object({
    storeReceiptImages: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

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
export type ExpenseLineInput = z.infer<typeof expenseLineSchema>;
