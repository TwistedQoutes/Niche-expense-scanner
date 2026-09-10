/**
 * Identifies an uploaded image by its actual bytes.
 *
 * The `Content-Type` a client sends is a claim, not a fact: anything can be
 * labelled `image/jpeg`. Since these bytes are stored and later served back to
 * a browser, the type has to be established from the file itself — otherwise an
 * HTML or SVG payload could be uploaded as an "image" and served from our
 * origin, which is a stored-XSS vector.
 *
 * The allowlist is deliberately the three formats every browser renders as a
 * raster image. **SVG is excluded on purpose**: it is a document format that can
 * carry script, not a picture.
 */

export type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Longest signature we need to inspect (WebP needs 12 bytes). */
const MAX_SIGNATURE_BYTES = 12;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP", at offset 8

/**
 * Returns the real image type, or null if the bytes are not one of the three
 * formats we accept. Never throws.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length < 4) return null;

  const head = bytes.subarray(0, MAX_SIGNATURE_BYTES);

  if (startsWith(head, JPEG)) return 'image/jpeg';
  if (startsWith(head, PNG)) return 'image/png';
  // A WebP file is a RIFF container whose form type is "WEBP" — both parts have
  // to match, or any RIFF file (a WAV, say) would pass.
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'image/webp';

  return null;
}

/** File extension for a sniffed type, used when building a storage key. */
export function extensionFor(type: SniffedImageType): string {
  switch (type) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}
