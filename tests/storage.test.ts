import { describe, expect, it } from 'vitest';

import { MAX_UPLOAD_BYTES, sniffImage, storageKeyFor } from '@/lib/storage/contract';

/**
 * What a file is, and where it is allowed to go.
 *
 * Both answers are taken away from the client on purpose. The type comes from the
 * bytes, not from the name or the declared `Content-Type`; the path comes from us,
 * not from the filename. Those two decisions are the whole security surface of an
 * upload feature, so they are tested directly rather than through a route.
 */

/** Minimal headers, long enough to pass the 12-byte floor. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const HEIC = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
]);

describe('sniffImage', () => {
  it('recognises the formats a phone actually produces', () => {
    expect(sniffImage(JPEG)).toEqual({ mime: 'image/jpeg', extension: 'jpg' });
    expect(sniffImage(PNG)).toEqual({ mime: 'image/png', extension: 'png' });
    expect(sniffImage(WEBP)).toEqual({ mime: 'image/webp', extension: 'webp' });
    // An iPhone shoots HEIC unless told otherwise; refusing it would reject the
    // most common camera on a job site.
    expect(sniffImage(HEIC)).toEqual({ mime: 'image/heic', extension: 'heic' });
  });

  it('refuses HTML, whatever it is called or claims to be', () => {
    /*
     * The case this exists for. A file named `before.jpg`, announced as
     * `image/jpeg`, containing a script — stored, then served back from our own
     * origin. Neither the name nor the header is consulted here, so neither helps.
     */
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect(sniffImage(html)).toBeNull();
  });

  it('refuses an SVG, which is a document that renders as an image', () => {
    // SVG is the trap in any "it's just an image" allow-list: it can carry script
    // and is not on the list of signatures, so it falls through to null.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffImage(svg)).toBeNull();
  });

  it('refuses a PDF, a ZIP and an ELF binary', () => {
    for (const header of [
      [0x25, 0x50, 0x44, 0x46], // %PDF
      [0x50, 0x4b, 0x03, 0x04], // PK..
      [0x7f, 0x45, 0x4c, 0x46], // .ELF
    ]) {
      const bytes = new Uint8Array(16);
      bytes.set(header);
      expect(sniffImage(bytes)).toBeNull();
    }
  });

  it('refuses something too short to identify rather than guessing', () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });

  it('refuses a file whose header appears later than the start', () => {
    // Prefixing a JPEG signature with padding is the obvious way to try to smuggle
    // one past a naive `includes`-style check.
    const shifted = new Uint8Array(16);
    shifted.set([0x00, 0x00, 0xff, 0xd8, 0xff]);
    expect(sniffImage(shifted)).toBeNull();
  });
});

describe('storageKeyFor', () => {
  it('puts the organization first, so a key is greppable back to its owner', () => {
    expect(storageKeyFor('org_alpha', 'jpg').startsWith('org_alpha/')).toBe(true);
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 500 }, () => storageKeyFor('org_alpha', 'jpg')));
    expect(keys.size).toBe(500);
  });

  it('contains nothing that could climb out of its prefix', () => {
    const key = storageKeyFor('org_alpha', 'jpg');
    expect(key).not.toContain('..');
    expect(key).toMatch(/^[\w-]+\/\d{4}-\d{2}\/[0-9a-f]{32}\.jpg$/);
  });

  it('takes the extension from the sniffed type, not from any filename', () => {
    // The call site passes `sniffImage(...).extension`. Proving the shape here
    // documents that a `.php` or `.html` cannot arrive through this argument in
    // practice, because nothing produces those.
    const key = storageKeyFor('org_alpha', sniffImage(PNG)!.extension);
    expect(key.endsWith('.png')).toBe(true);
  });
});

describe('the upload cap', () => {
  it('sits below the platform request limit it has to fit inside', () => {
    // Vercel refuses a serverless request body over ~4.5 MB, and uploads are
    // proxied through the application rather than sent straight to the bucket.
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    // …and is still big enough for a phone photo, which is 1–3 MB.
    expect(MAX_UPLOAD_BYTES).toBeGreaterThanOrEqual(4 * 1024 * 1024);
  });
});
