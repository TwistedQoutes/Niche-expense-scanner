import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildImageKey, isValidImageKey } from '@/lib/storage/driver';
import { createLocalDriver } from '@/lib/storage/local';
import { extensionFor, sniffImageType } from '@/lib/storage/sniff';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('sniffImageType', () => {
  it('identifies JPEG, PNG and WebP by signature', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(
      sniffImageType(
        bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50),
      ),
    ).toBe('image/webp');
  });

  it('rejects SVG — a document format that can carry script', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(sniffImageType(svg)).toBeNull();
  });

  it('rejects HTML dressed up as an image', () => {
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
    expect(sniffImageType(html)).toBeNull();
  });

  it('rejects a RIFF container that is not WebP', () => {
    // A WAV file: "RIFF" then "WAVE". Checking only the RIFF prefix would pass it.
    const wav = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('rejects empty, tiny and arbitrary input without throwing', () => {
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(bytes(0xff))).toBeNull();
    expect(sniffImageType(bytes(1, 2, 3, 4, 5, 6, 7, 8))).toBeNull();
  });

  it('does not accept a truncated PNG signature', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
  });
});

describe('extensionFor', () => {
  it('maps each accepted type to an extension', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/webp')).toBe('webp');
  });
});

describe('buildImageKey', () => {
  it('scopes the key to the user and makes it unguessable', () => {
    const key = buildImageKey('user_abc123', 'image/jpeg');
    expect(key).toMatch(/^receipts\/user_abc123\/[0-9a-f-]{36}\.jpg$/);
    expect(isValidImageKey(key)).toBe(true);
  });

  it('never produces the same key twice', () => {
    const keys = new Set(Array.from({ length: 50 }, () => buildImageKey('u1', 'image/png')));
    expect(keys.size).toBe(50);
  });
});

describe('isValidImageKey', () => {
  it('accepts the shape we generate', () => {
    expect(isValidImageKey('receipts/u1/0d1e2f30-4a5b-6c7d-8e9f-a0b1c2d3e4f5.jpg')).toBe(true);
  });

  it('rejects traversal, absolute paths and null bytes', () => {
    expect(isValidImageKey('receipts/u1/../../../etc/passwd')).toBe(false);
    expect(isValidImageKey('../../etc/passwd')).toBe(false);
    expect(isValidImageKey('/etc/passwd')).toBe(false);
    expect(isValidImageKey('receipts/u1/a.jpg\0.png')).toBe(false);
  });

  it('rejects anything outside the receipts prefix or with a foreign extension', () => {
    expect(isValidImageKey('secrets/u1/a.jpg')).toBe(false);
    expect(isValidImageKey('receipts/u1/a.svg')).toBe(false);
    expect(isValidImageKey('receipts/u1/a.html')).toBe(false);
    expect(isValidImageKey('receipts/u1/a')).toBe(false);
    expect(isValidImageKey('')).toBe(false);
  });
});

describe('createLocalDriver', () => {
  async function driverInTempDir() {
    const root = await mkdtemp(path.join(tmpdir(), 'nes-storage-'));
    return { root, driver: createLocalDriver(root) };
  }

  it('round-trips an image', async () => {
    const { driver } = await driverInTempDir();
    const key = buildImageKey('u1', 'image/jpeg');
    const data = bytes(0xff, 0xd8, 0xff, 0x01, 0x02);

    await driver.put(key, data, 'image/jpeg');
    expect(await driver.get(key)).toEqual(data);
  });

  it('returns null for a key that was never written', async () => {
    const { driver } = await driverInTempDir();
    expect(await driver.get(buildImageKey('u1', 'image/jpeg'))).toBeNull();
  });

  it('writes inside the root, in a per-user directory', async () => {
    const { root, driver } = await driverInTempDir();
    const key = buildImageKey('u1', 'image/png');
    await driver.put(key, bytes(0x89, 0x50), 'image/png');

    // Readable at the expected absolute path, and nowhere else.
    await expect(readFile(path.join(root, key))).resolves.toBeDefined();
  });

  it('refuses to read or write outside the storage root', async () => {
    const { driver } = await driverInTempDir();

    for (const key of ['../escape.jpg', 'receipts/u1/../../escape.jpg', '/etc/passwd']) {
      await expect(driver.put(key, bytes(0xff, 0xd8, 0xff), 'image/jpeg')).rejects.toThrow();
      await expect(driver.get(key)).rejects.toThrow();
      await expect(driver.delete(key)).rejects.toThrow();
    }
  });

  it('does not overwrite an existing object', async () => {
    const { driver } = await driverInTempDir();
    const key = buildImageKey('u1', 'image/jpeg');
    await driver.put(key, bytes(1, 2, 3), 'image/jpeg');
    // Keys are random, so a collision means something is badly wrong; failing
    // loudly beats silently replacing someone's receipt.
    await expect(driver.put(key, bytes(4, 5, 6), 'image/jpeg')).rejects.toThrow();
  });

  it('deletes, and deleting twice still succeeds', async () => {
    const { driver } = await driverInTempDir();
    const key = buildImageKey('u1', 'image/jpeg');
    await driver.put(key, bytes(0xff, 0xd8, 0xff), 'image/jpeg');

    await driver.delete(key);
    expect(await driver.get(key)).toBeNull();
    await expect(driver.delete(key)).resolves.toBeUndefined();
  });

  it('cannot be tricked into reading a file placed just outside the root', async () => {
    const { root, driver } = await driverInTempDir();
    const secret = path.join(path.dirname(root), 'secret.jpg');
    await writeFile(secret, 'top secret');

    await expect(driver.get(`../${path.basename(secret)}`)).rejects.toThrow();
  });
});
