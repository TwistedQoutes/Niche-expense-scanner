import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isValidImageKey, type StorageDriver } from '@/lib/storage/driver';

/**
 * Local-disk driver.
 *
 * Files live under `./storage` — deliberately *outside* `public/`, so nothing
 * is ever served statically. Every read goes through an authenticated route
 * that checks the requester owns the expense; putting these bytes in `public/`
 * would make a receipt readable by anyone who guessed the URL.
 *
 * Suitable for a single-node deployment. For anything horizontally scaled the
 * bytes belong in object storage — implement the same three methods against
 * S3/R2 and swap the driver in `resolveStorage()`.
 */
export function createLocalDriver(rootDirectory: string): StorageDriver {
  const root = path.resolve(rootDirectory);

  /**
   * Resolves a key to an absolute path, refusing anything that escapes the root.
   *
   * Two independent checks: the key pattern, and a resolved-path containment
   * test. Belt and braces, because a traversal here reads or overwrites
   * arbitrary files on the host.
   */
  function resolveKey(key: string): string {
    if (!isValidImageKey(key)) {
      throw new Error('Refusing to touch a malformed storage key.');
    }

    const target = path.resolve(root, key);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error('Refusing to touch a path outside the storage root.');
    }

    return target;
  }

  return {
    name: 'local',

    async put(key, data) {
      const target = resolveKey(key);
      await mkdir(path.dirname(target), { recursive: true });
      // 0o600: readable only by the process owner. These are private documents.
      await writeFile(target, data, { mode: 0o600, flag: 'wx' });
    },

    async get(key) {
      const target = resolveKey(key);
      try {
        const data = await readFile(target);
        return new Uint8Array(data);
      } catch (error) {
        // A missing file is a normal outcome (deleted out of band); anything
        // else is worth surfacing.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },

    async delete(key) {
      const target = resolveKey(key);
      // `force` so deleting an already-gone file succeeds: the caller's intent
      // is "this should not exist", and it does not.
      await rm(target, { force: true });
    },
  };
}
