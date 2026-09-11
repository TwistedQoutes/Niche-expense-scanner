import { z } from 'zod';

import { emailSchema, optionalPhoneSchema, singleLineText } from '@/lib/validation/common';

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Length over composition rules.
 *
 * A 10-character minimum with an upper bound beats forcing a symbol and a
 * digit. The upper bound is not arbitrary: bcrypt silently ignores everything
 * past 72 bytes, so accepting a longer password would give the user a false
 * sense of security about a secret that is really only 72 bytes long.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(72, 'Passwords are limited to 72 characters.');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  /** The business being created. Its name is the workspace name. */
  businessName: singleLineText(120, 'That business name is too long.').pipe(
    z.string().min(2, 'What is the business called?'),
  ),
  ownerName: singleLineText(120, 'That name is too long.').pipe(
    z.string().min(1, 'What should we call you?'),
  ),
  phone: optionalPhoneSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  /**
   * The *minimum* is deliberately not enforced here: rejecting a short password
   * at login would advertise the policy to an attacker and helps no one.
   *
   * The maximum is enforced and must match signup's. bcrypt ignores anything
   * past 72 bytes, so a laxer limit here would mean "correct password plus any
   * trailing junk" authenticates. Not exploitable — signup caps stored
   * passwords at 72 too — but surprising authentication code is how real holes
   * get built on top.
   */
  password: z.string().min(1, 'Enter your password.').max(72),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'That link is missing its token.').max(256),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'That link is missing its token.').max(256),
});

/** Switching the active workspace for a user who belongs to more than one. */
export const switchOrganizationSchema = z.object({
  organizationId: z.string().min(1).max(64),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
