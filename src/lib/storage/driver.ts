import { randomUUID } from 'node:crypto';

import { extensionFor, type SniffedImageType } from '@/lib/storage/sniff';

/**
 * The storage contract.
 *
 * Small on purpose: put, get, delete. That is everything the app needs, and it
 * is the intersection of what local disk, S3, R2 and GCS all do, so swapping
 * the driver is a config change rather than a rewrite.
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/**
 * Keys are generated here and never accepted from a client.
 *
 * The user id prefix means a listing is naturally scoped per artist, and the
 * random component means knowing an expense id does not let you guess the key
 * of someone else's receipt.
 */
export function buildImageKey(userId: string, type: SniffedImageType): string {
  return `receipts/${userId}/${randomUUID()}.${extensionFor(type)}`;
}

/**
 * Validates a key before it reaches the filesystem.
 *
 * Keys we generate always pass. This exists for the ones that come back out of
 * the database, which a determined attacker with write access there — or a
 * future bug — could have tampered with. The pattern is restrictive enough that
 * `..`, absolute paths, and anything but the shape above are rejected outright.
 */
const KEY_PATTERN = /^receipts\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9-]{1,64}\.(?:jpg|png|webp)$/;

export function isValidImageKey(key: string): boolean {
  // Rejected before the pattern test so a traversal attempt is unambiguous
  // regardless of how the pattern is later edited.
  if (key.includes('..') || key.includes('\0') || key.startsWith('/')) return false;
  return KEY_PATTERN.test(key);
}
