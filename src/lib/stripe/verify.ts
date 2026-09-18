import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifying that a webhook really came from Stripe.
 *
 * This is the most consequential check in the product. The webhook is what tells
 * us a workspace has paid, so a forged one is a free Business plan for anybody
 * who can post to the endpoint — and a forged `customer.subscription.deleted` is
 * a way to downgrade a paying customer out of spite.
 *
 * Stripe's scheme, from their documented algorithm:
 *
 *   1. Read the `Stripe-Signature` header: `t=<timestamp>,v1=<signature>,v1=...`
 *   2. Build the signed payload as `<timestamp>.<raw request body>`.
 *   3. HMAC-SHA256 it with the endpoint's signing secret.
 *   4. Compare, in constant time, against **any** of the `v1` values.
 *
 * Three details decide whether an implementation is actually safe:
 *
 *  - **The raw body.** `JSON.parse` then `JSON.stringify` changes key order and
 *    whitespace, and the signature is over the bytes Stripe sent. Re-serialising
 *    makes every legitimate webhook fail — and the usual "fix" for that is to stop
 *    verifying.
 *  - **The timestamp.** Without a tolerance, a signature stays valid forever, so
 *    anyone who captures one request can replay it — re-crediting a payment, or
 *    re-applying a cancellation — as often as they like.
 *  - **Several v1 values.** During a secret rotation Stripe sends more than one.
 *    Reading only the first breaks every webhook for the length of the rollover.
 */

/** How far out of date a signature may be. Stripe's own default. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureHeader = {
  timestamp: number;
  signatures: string[];
};

export function parseSignatureHeader(header: string): SignatureHeader | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === 't') {
      /*
       * Rejects "t=abc" and, separately, "t=" — `Number('')` is 0, not NaN, so an
       * empty timestamp would otherwise parse as the epoch. The tolerance check
       * below would still refuse it, but it would be refused as "too old" rather
       * than as the malformed header it is, and it would become a real hole the
       * moment anybody relaxed the tolerance.
       */
      if (value === '') return null;

      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      timestamp = parsed;
    } else if (key === 'v1') {
      // Every v1, not just the first: during a rotation Stripe signs with both
      // the old and the new secret.
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return null;

  return { timestamp, signatures };
}

export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex signatures.
 *
 * `===` on a MAC leaks how many leading bytes matched, which is enough to forge
 * one byte at a time given enough attempts.
 */
export function signaturesMatch(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');

  // timingSafeEqual throws on a length mismatch, and a signature's length is not
  // a secret, so short-circuiting leaks nothing and not crashing is required.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'missing_signature' | 'malformed' | 'too_old' | 'mismatch' };

export function verifyStripeSignature(input: {
  secret: string | undefined;
  /** The bytes Stripe sent, exactly as received. Never a re-serialised object. */
  rawBody: string;
  signatureHeader: string | null;
  now?: Date;
  toleranceSeconds?: number;
}): VerificationResult {
  /*
   * No secret means we cannot verify, and an unverifiable webhook must be
   * rejected rather than trusted. Failing closed is the whole point: the
   * alternative — accepting when unconfigured — turns a missing environment
   * variable into a way to grant yourself a paid plan.
   */
  if (!input.secret) return { ok: false, reason: 'not_configured' };
  if (!input.signatureHeader) return { ok: false, reason: 'missing_signature' };

  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed' };

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  /*
   * Absolute difference, so a signature from the future is refused too. A clock
   * skew that large is a misconfiguration worth surfacing, and accepting future
   * timestamps would let an attacker who ever obtains a valid signature keep it
   * usable indefinitely.
   */
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) {
    return { ok: false, reason: 'too_old' };
  }

  const expected = computeSignature(input.secret, parsed.timestamp, input.rawBody);

  // Every candidate is compared, and all of them in constant time — no early
  // return on the first mismatch.
  let matched = false;
  for (const candidate of parsed.signatures) {
    if (signaturesMatch(expected, candidate)) matched = true;
  }

  return matched ? { ok: true } : { ok: false, reason: 'mismatch' };
}
