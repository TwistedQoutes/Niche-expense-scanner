import path from 'node:path';

import { getEnv } from '@/lib/env';
import type { StorageDriver } from '@/lib/storage/driver';
import { createLocalDriver } from '@/lib/storage/local';

export { buildImageKey, isValidImageKey, type StorageDriver } from '@/lib/storage/driver';
export { extensionFor, sniffImageType, type SniffedImageType } from '@/lib/storage/sniff';

/** Largest receipt image we will accept, after the client has re-encoded it. */
export const MAX_STORED_IMAGE_BYTES = 5 * 1024 * 1024;

let cached: StorageDriver | null | undefined;

/**
 * Resolves the configured driver, or null when retention is switched off.
 *
 * `RECEIPT_STORAGE_DRIVER=none` is the default, and it disables the feature
 * outright — the routes 404 and the UI keeps its "images never leave your
 * device" claim. Storage is something a deployment turns on deliberately.
 */
export function resolveStorage(): StorageDriver | null {
  if (cached !== undefined) return cached;

  const { RECEIPT_STORAGE_DRIVER } = getEnv();

  cached =
    RECEIPT_STORAGE_DRIVER === 'local'
      ? createLocalDriver(path.join(process.cwd(), 'storage'))
      : null;

  return cached;
}

/** True when this deployment can retain images at all. */
export function storageEnabled(): boolean {
  return resolveStorage() !== null;
}

/** Test seam: forces the driver to be resolved again. */
export function __resetStorage(): void {
  cached = undefined;
}
