import { randomBytes } from 'node:crypto';

/**
 * What every storage driver has to do, and the rules that hold whichever one is
 * configured.
 *
 * Uploads are proxied through the application rather than sent straight to the
 * bucket from the browser. Presigned uploads would be faster and would dodge the
 * serverless body limit, but they move the authorisation decision to whoever holds
 * the URL — and the thing being stored here is a photograph of a customer's house,
 * taken at their address, belonging to exactly one business. One place that
 * decides who may read a file is worth more than the throughput, at this size.
 *
 * That choice has a cost and it is named rather than hidden: every file passes
 * through a function invocation, so the cap below is deliberately small and
 * Vercel's own request limit (~4.5 MB) sits just above it.
 */

/** 4 MB. A phone photo is 1–3 MB; anything larger is not a job photo. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * What a browser may upload, by what the bytes actually are.
 *
 * An allow-list of image formats, checked against the file's leading bytes rather
 * than its extension or its `Content-Type` — both of which the client chooses. An
 * HTML file named `before.jpg` and announced as `image/jpeg` is the oldest stored-XSS
 * trick there is, and the one that matters when the file is later served back.
 */
const SIGNATURES: { mime: string; extension: string; test: (bytes: Uint8Array) => boolean }[] = [
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    extension: 'png',
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    extension: 'webp',
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    // HEIC/HEIF: what an iPhone produces unless told otherwise, so refusing it
    // would reject the most common camera on a job site.
    mime: 'image/heic',
    extension: 'heic',
    test: (b) =>
      b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
      // major brand: heic, heix, hevc, mif1
      [
        [0x68, 0x65, 0x69, 0x63],
        [0x68, 0x65, 0x69, 0x78],
        [0x68, 0x65, 0x76, 0x63],
        [0x6d, 0x69, 0x66, 0x31],
      ].some((brand) => brand.every((byte, index) => b[8 + index] === byte)),
  },
];

export type SniffedType = { mime: string; extension: string };

/**
 * Identifies a file by its contents, or refuses it.
 *
 * Returns null for anything not on the list, which the caller turns into a
 * validation error naming the formats that are accepted.
 */
export function sniffImage(bytes: Uint8Array): SniffedType | null {
  if (bytes.length < 12) return null;

  const match = SIGNATURES.find((signature) => signature.test(bytes));
  return match ? { mime: match.mime, extension: match.extension } : null;
}

/**
 * Where a file lives, decided entirely by us.
 *
 * The organization id is the first segment, so a misconfigured bucket policy or a
 * careless prefix listing still cannot cross a tenant boundary — and a key is
 * greppable back to its owner. The random middle means a key cannot be guessed
 * from anything a person knows, and the original filename never appears: it is
 * client-supplied, and joining it into a path is how an upload gets written
 * somewhere it should not be.
 */
export function storageKeyFor(organizationId: string, extension: string): string {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  return `${organizationId}/${month}/${randomBytes(16).toString('hex')}.${extension}`;
}

export type StoredObject = { body: Uint8Array; mimeType: string };

/**
 * The driver contract.
 *
 * Deliberately three methods. Anything richer — listing, copying, signed URLs —
 * would be a capability the application does not use and a surface each driver
 * has to get right.
 */
export type StorageDriver = {
  readonly name: string;
  put(key: string, body: Uint8Array, mimeType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
};
