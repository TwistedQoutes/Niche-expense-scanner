import { randomBytes } from 'node:crypto';

import type { TenantClient } from '@/lib/db/tenant';

/**
 * Human-facing document numbers, and the unguessable ids behind public links.
 *
 * Two different jobs that are easy to confuse:
 *
 *  - **Numbers** (Q-1001, J-1001) are for people. They are sequential per
 *    business, because a customer ringing up about "quote 1004" needs that to
 *    mean something, and an owner filing them wants them in order.
 *  - **Public ids** are credentials. A quote page has no login — the id in the
 *    URL is the only thing standing between a customer's price and anyone who
 *    guesses a URL — so it is random, not sequential.
 *
 * Using one value for both jobs is the mistake this module exists to prevent:
 * a sequential public id means /quote/1002 reveals the next business's quote.
 */

/** Where each document type's numbering starts. 1001 looks established. */
const FIRST_NUMBER = 1001;

export type NumberedDocument = 'quote' | 'job';

const PREFIX: Record<NumberedDocument, string> = { quote: 'Q-', job: 'J-' };

/**
 * The next number for this business, as a string like "Q-1004".
 *
 * Derived from the highest existing number rather than from a count: counting
 * rows would reissue a number after a deletion, and two documents sharing a
 * number is exactly the confusion the number exists to avoid.
 *
 * There is a race here — two simultaneous creates can read the same maximum —
 * and it is closed at the database instead of with a lock. Both `Quote` and
 * `Job` carry a unique index on (organizationId, number), so the loser of the
 * race gets a constraint violation and `withNumberRetry` tries again. That is
 * cheaper than serialising every quote creation in the business behind a lock.
 */
export async function nextNumber(
  db: TenantClient,
  document: NumberedDocument,
): Promise<string> {
  const prefix = PREFIX[document];

  const latest =
    document === 'quote'
      ? await db.quote.findFirst({ orderBy: { number: 'desc' }, select: { number: true } })
      : await db.job.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });

  if (!latest) return `${prefix}${FIRST_NUMBER}`;

  // Ordering is lexical, not numeric, so "Q-999" would sort above "Q-1000".
  // Parsing the suffix and taking the max is the only correct reading, and the
  // zero-free FIRST_NUMBER keeps the two orders aligned for the first 9,000
  // documents anyway.
  const suffix = Number.parseInt(latest.number.replace(prefix, ''), 10);
  const next = Number.isFinite(suffix) ? suffix + 1 : FIRST_NUMBER;

  return `${prefix}${Math.max(next, FIRST_NUMBER)}`;
}

/**
 * Runs a create that may lose a numbering race, retrying with a fresh number.
 *
 * Three attempts. A business creating quotes fast enough to collide three times
 * in a row is not a real scenario; a loop without a bound is.
 */
export async function withNumberRetry<T>(
  attempt: (number: string) => Promise<T>,
  nextValue: () => Promise<string>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;

  for (let tries = 0; tries < attempts; tries += 1) {
    try {
      return await attempt(await nextValue());
    } catch (error) {
      // P2002 is the unique constraint on (organizationId, number) — someone
      // else took this number between our read and our write.
      const isCollision =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

      if (!isCollision) throw error;
      lastError = error;
    }
  }

  throw lastError;
}

/**
 * The unguessable half of a public quote URL.
 *
 * 128 bits of randomness, base64url so it is safe in a path and readable over
 * the phone if it has to be. This is the whole access control on a quote page —
 * a customer must be able to open one without an account — so it must not be
 * derivable from anything: not the quote number, not the organization, not the
 * time it was created.
 */
export function generatePublicId(): string {
  return randomBytes(16).toString('base64url');
}

/** Shape check for a public id arriving in a URL, before it reaches Postgres. */
export function isPublicIdShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(value);
}
