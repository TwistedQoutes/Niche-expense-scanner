import { describe, expect, it } from 'vitest';

import { encodeKeyPath, encodeSegment, sha256Hex, signRequest } from '@/lib/storage/sigv4';

/**
 * Checked against the signatures AWS publishes, not against itself.
 *
 * Hand-written request signing is fine to own — the algorithm is fully specified
 * and does not move — but only if it is held to someone else's answer. These are
 * the worked examples from the S3 "Signature Calculations for the Authorization
 * Header" documentation, where AWS gives the canonical request, the string to
 * sign and the final signature for a known key, date and payload. If this
 * implementation gets the canonical form even slightly wrong — a header out of
 * order, whitespace uncollapsed, the wrong payload hash — the signature diverges
 * completely, which is what makes these worth having.
 */

// The credentials from AWS's own examples. Not secrets: they are printed in the
// documentation precisely so implementations can check themselves.
const ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
const SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const EMPTY_PAYLOAD = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('SigV4 against AWS’s published examples', () => {
  it('signs the documented GET of a single object', () => {
    const headers = signRequest({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      payloadHash: EMPTY_PAYLOAD,
      headers: { range: 'bytes=0-9' },
      now: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
    });

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('signs the documented PUT of an object', () => {
    // "Welcome to Amazon S3." — the body from the same example, whose hash AWS
    // gives as the x-amz-content-sha256 below.
    const body = 'Welcome to Amazon S3.';

    const headers = signRequest({
      method: 'PUT',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test%24file.text',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      payloadHash: sha256Hex(body),
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      now: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
    });

    expect(headers['x-amz-content-sha256']).toBe(
      '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    );

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, ' +
        'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('signs a listing, which is where the query string has to be canonical', () => {
    const headers = signRequest({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/',
      query: 'max-keys=2&prefix=J',
      region: 'us-east-1',
      service: 's3',
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      payloadHash: EMPTY_PAYLOAD,
      now: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
    });

    expect(headers.authorization).toContain(
      'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    );
  });
});

describe('encoding', () => {
  it('encodes the characters encodeURIComponent leaves alone', () => {
    // These five are the difference between a key that signs and one that returns
    // SignatureDoesNotMatch with no hint about which character caused it.
    expect(encodeSegment("!'()*")).toBe('%21%27%28%29%2A');
  });

  it('encodes each segment but keeps the separators', () => {
    expect(encodeKeyPath('org_1/2026-09/ab cd.jpg')).toBe('org_1/2026-09/ab%20cd.jpg');
  });

  it('encodes a slash *inside* a segment, so a key cannot climb the path', () => {
    expect(encodeSegment('../secret')).toBe('..%2Fsecret');
  });
});
