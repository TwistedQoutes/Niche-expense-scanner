import { Role } from '@prisma/client';
import { z } from 'zod';

import { PASSWORD_MIN_LENGTH, passwordSchema } from '@/lib/validation/auth';
import { emailSchema, singleLineText } from '@/lib/validation/common';

/**
 * Inviting someone, and the two ways an invitation can be taken up.
 *
 * `OWNER` is absent from `inviteRoleSchema` on purpose. Ownership is not a role
 * you hand out from a form — it is transferred, which is a different act with
 * different consequences (the previous owner stops being able to undo it), and
 * the rank check in the route would refuse it anyway since nobody outranks an
 * owner. Leaving it out of the schema means the API says "that is not a role you
 * can invite" instead of "you are not allowed", which is the truer answer.
 */
export const inviteRoleSchema = z.enum([Role.ADMIN, Role.STAFF]);

export const createInviteSchema = z.object({
  email: emailSchema,
  role: inviteRoleSchema.default(Role.STAFF),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/**
 * The token as it arrives from the URL.
 *
 * Shape-checked before it reaches Postgres. An unknown token is harmless — it
 * hashes to nothing that exists — but one carrying a NUL byte crashes the query,
 * which any visitor could trigger with a single character in the path.
 */
export const inviteTokenSchema = z
  .string()
  .trim()
  .min(1, 'That invitation link is not valid.')
  .max(256, 'That invitation link is not valid.')
  .regex(/^[A-Za-z0-9_-]+$/, 'That invitation link is not valid.');

/**
 * Accepting as a new person: the invitation proves the email, so all that is
 * missing is a name and a password.
 */
export const acceptInviteSchema = z.object({
  token: inviteTokenSchema,
  name: singleLineText(120, 'That name is too long.'),
  password: passwordSchema,
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/** Accepting when the address already has an account: nothing to collect. */
export const claimInviteSchema = z.object({ token: inviteTokenSchema });

export const updateMemberSchema = z.object({
  role: inviteRoleSchema,
});

export { PASSWORD_MIN_LENGTH };
