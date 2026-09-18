import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4, by hand.
 *
 * Written out rather than pulled in with an SDK because this is the only AWS call
 * the product makes, and `@aws-sdk/client-s3` is tens of megabytes of dependency
 * for one PUT, one GET and one DELETE — on a serverless platform where bundle size
 * is cold-start time on every request, including the ones that never touch a file.
 *
 * The algorithm is fully specified and does not move, which is what makes writing
 * it acceptable: `tests/sigv4.test.ts` checks this implementation against the
 * signatures AWS publishes in its own documentation, so "I think I got the
 * canonical form right" is not the standard it is held to.
 *
 * It is S3-compatible rather than S3-specific: Cloudflare R2, Backblaze B2 and
 * MinIO all speak the same protocol, which is the difference between choosing a
 * bucket and being chosen by one.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Percent-encodes a path segment the way AWS expects.
 *
 * `encodeURIComponent` leaves `!'()*` alone and AWS does not, so a key containing
 * one would sign differently from how it is sent — a mismatch that surfaces as an
 * opaque SignatureDoesNotMatch rather than as anything about the character.
 */
export function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Each `/`-separated segment encoded, the separators left intact. */
export function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeSegment).join('/');
}

export type SignInput = {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  /** Host header value, e.g. `bucket.s3.eu-west-1.amazonaws.com`. */
  host: string;
  /** Absolute path, already percent-encoded. */
  path: string;
  /** Canonical query string, already encoded and sorted. Empty when there is none. */
  query?: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
  /** Hex SHA-256 of the body. `UNSIGNED-PAYLOAD` is deliberately not supported. */
  payloadHash: string;
  headers?: Record<string, string>;
  now?: Date;
};

/** The headers to send, including `Authorization`. */
export function signRequest(input: SignInput): Record<string, string> {
  const now = input.now ?? new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
    ...(input.sessionToken ? { 'x-amz-security-token': input.sessionToken } : {}),
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    ),
  };

  // Canonical headers: lower-cased names, sorted, values trimmed and inner runs of
  // whitespace collapsed.
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${headers[name]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalRequest = [
    input.method,
    input.path,
    input.query ?? '',
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), input.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
