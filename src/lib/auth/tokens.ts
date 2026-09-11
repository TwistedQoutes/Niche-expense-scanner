import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '@/lib/db';

/**
 * Single-use tokens for password reset and email verification.
 *
 * Two decisions worth stating:
 *
 * 1. **Only a hash is stored.** The token goes out in an email and never lands
 *    in the database in usable form, so a database leak does not become an
 *    account-takeover kit.
 * 2. **256 bits of randomness.** Long enough that guessing is not a threat
 *    model, which is what lets the token itself be the whole proof of email
 *    control.
 */

export type TokenPurpose = 'password_reset' | 'email_verify';

/** Reset links are short-lived; an old email in an inbox stops being a key. */
const TTL_SECONDS: Record<TokenPurpose, number> = {
  password_reset: 60 * 60, // 1 hour
  email_verify: 60 * 60 * 24 * 3, // 3 days — less sensitive, more forgiving
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues a token and returns the plaintext, which is the only time it exists in
 * readable form. Any outstanding token for the same purpose is consumed first,
 * so requesting a second reset link invalidates the first.
 */
export async function issueToken(
  userId: string,
  purpose: TokenPurpose,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_SECONDS[purpose] * 1000);

  await prisma.$transaction([
    prisma.authToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: { userId, purpose, tokenHash: hashToken(token), expiresAt },
    }),
  ]);

  return { token, expiresAt };
}

/**
 * Redeems a token, returning the user id it belonged to, or null.
 *
 * The redemption is a conditional update rather than a read-then-write: two
 * simultaneous requests with the same token cannot both succeed, because only
 * one can flip `usedAt` from null.
 */
export async function redeemToken(
  token: string,
  purpose: TokenPurpose,
): Promise<string | null> {
  if (token.length === 0 || token.length > 256) return null;

  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true },
  });

  if (!record) return null;
  if (record.purpose !== purpose) return null;
  if (record.usedAt !== null) return null;
  if (record.expiresAt.getTime() <= Date.now()) return null;

  const claimed = await prisma.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Lost the race: another request redeemed it microseconds ago.
  if (claimed.count === 0) return null;

  return record.userId;
}

/** Housekeeping: drops tokens that are spent or long expired. */
export async function pruneTokens(): Promise<number> {
  const { count } = await prisma.authToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        { usedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      ],
    },
  });
  return count;
}
