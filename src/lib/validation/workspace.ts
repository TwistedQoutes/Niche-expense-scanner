import { z } from 'zod';

/**
 * Confirming a workspace deletion.
 *
 * Two proofs, for two different mistakes. The typed name catches the owner who
 * is in the wrong workspace or clicked without reading. The password catches the
 * person who is not the owner at all — a laptop left signed in at the shop is
 * enough to reach this screen, and a session cookie alone should not be enough
 * to destroy a business.
 *
 * The password is not checked against the strength rules here: it is being
 * compared, not set, and an owner whose password predates a rule must still be
 * able to type it. The cap only keeps an absurd body away from the hash.
 */
export const deleteWorkspaceSchema = z.object({
  confirmName: z.string().trim().min(1, 'Type the name of your business to confirm.').max(200),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceSchema>;

/**
 * Whether the typed name matches.
 *
 * Case and surrounding spaces are forgiven; everything else must match. "green
 * acres lawn" for "Green Acres Lawn" is plainly the same intent, while a
 * near-miss on the words is exactly the hesitation this step exists to catch.
 */
export function namesMatch(typed: string, actual: string): boolean {
  const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return normalise(typed) === normalise(actual);
}
