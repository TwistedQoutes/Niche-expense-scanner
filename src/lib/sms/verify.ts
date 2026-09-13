import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifying that a webhook really came from Twilio.
 *
 * Without this, `/api/webhooks/twilio` is an endpoint where anyone on the
 * internet can claim to be a customer: they could inject messages into a
 * business's inbox, create leads, and — because a STOP is honoured — unsubscribe
 * that business's customers from their own follow-ups. It is the single most
 * important check in this phase.
 *
 * Twilio's scheme, from their documented algorithm:
 *
 *   1. Take the full URL Twilio was configured to POST to, including the query
 *      string.
 *   2. Append every POST parameter, sorted by name, as `name` + `value` with no
 *      separators at all.
 *   3. HMAC-SHA1 that string with the account's auth token.
 *   4. Base64 the digest and compare against `X-Twilio-Signature`.
 *
 * The two details that break implementations: the URL must be the one Twilio
 * *thinks* it is calling (behind a proxy the request's own host differs, which is
 * why TWILIO_WEBHOOK_URL exists), and the parameters are concatenated with no
 * delimiter — `a=1&b=2` becomes `a1b2`.
 */

export function buildSignatureBase(url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();

  // No separators between name and value, or between pairs. This is Twilio's
  // format, not a choice.
  return sortedKeys.reduce((accumulated, key) => accumulated + key + params[key], url);
}

export function computeSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  return createHmac('sha1', authToken).update(buildSignatureBase(url, params), 'utf8').digest('base64');
}

/**
 * Constant-time comparison of two base64 signatures.
 *
 * `===` on a MAC leaks how many leading bytes matched, which is enough to forge
 * one byte at a time given enough attempts.
 */
export function signaturesMatch(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');

  // timingSafeEqual throws on a length mismatch, and the length of a signature
  // is not a secret, so this short-circuit leaks nothing.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'missing_signature' | 'mismatch' };

export function verifyTwilioSignature(input: {
  authToken: string | undefined;
  /** The URL Twilio signed — see TWILIO_WEBHOOK_URL. */
  url: string;
  params: Record<string, string>;
  signatureHeader: string | null;
}): VerificationResult {
  /*
   * No token means we cannot verify, and an unverifiable webhook must be
   * rejected rather than trusted. Failing closed is the whole point: the
   * alternative — accepting when unconfigured — turns a missing environment
   * variable into an open endpoint.
   */
  if (!input.authToken) return { ok: false, reason: 'not_configured' };
  if (!input.signatureHeader) return { ok: false, reason: 'missing_signature' };

  const expected = computeSignature(input.authToken, input.url, input.params);

  return signaturesMatch(expected, input.signatureHeader)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}
