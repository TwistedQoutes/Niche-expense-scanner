#!/usr/bin/env node
/**
 * Copies the Tesseract engine, its WASM core and the English language model out
 * of node_modules and into ./public/ocr so the browser loads them from our own
 * origin instead of a third-party CDN.
 *
 * Why bother: it removes a runtime dependency on unpkg/jsdelivr, lets the
 * Content-Security-Policy stay `'self'`-only, keeps OCR working offline once the
 * assets are cached, and pins the exact model version we test against.
 *
 * The output is git-ignored and regenerated on install/build, so the ~50 MB of
 * WASM never lands in the repository.
 */
import { createRequire } from 'node:module';
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const publicOcrDir = path.join(process.cwd(), 'public', 'ocr');

/** Resolve a package's directory without importing it (works for asset-only packages). */
function packageDir(pkg) {
  return path.dirname(require.resolve(`${pkg}/package.json`));
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Copy `from` to `to` unless an identically sized file is already in place. */
async function copyFile(from, to) {
  const [source, destination] = await Promise.all([
    stat(from),
    exists(to).then((present) => (present ? stat(to) : null)),
  ]);
  if (destination && destination.size === source.size) return false;
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to);
  return true;
}

async function main() {
  let copied = 0;

  // 1. The worker script that drives the engine.
  const tesseractDist = path.join(packageDir('tesseract.js'), 'dist');
  if (await copyFile(path.join(tesseractDist, 'worker.min.js'), path.join(publicOcrDir, 'worker.min.js'))) {
    copied += 1;
  }

  // 2. The WASM core. tesseract.js feature-detects SIMD support at runtime and
  //    picks one of several builds, so all variants have to be available.
  const coreDir = packageDir('tesseract.js-core');
  for (const entry of await readdir(coreDir)) {
    if (!entry.startsWith('tesseract-core')) continue;
    if (await copyFile(path.join(coreDir, entry), path.join(publicOcrDir, 'core', entry))) {
      copied += 1;
    }
  }

  // 3. The English LSTM model. "4.0.0" is the standard (fast) model; the
  //    "4.0.0_best_int" directory in the same package holds the slower, more
  //    accurate one if receipt accuracy ever needs a bump.
  const langSource = path.join(packageDir('@tesseract.js-data/eng'), '4.0.0', 'eng.traineddata.gz');
  if (await copyFile(langSource, path.join(publicOcrDir, 'lang', 'eng.traineddata.gz'))) {
    copied += 1;
  }

  console.log(
    copied === 0
      ? '[ocr-assets] already up to date'
      : `[ocr-assets] copied ${copied} file(s) into public/ocr`,
  );
}

main().catch((error) => {
  console.error('[ocr-assets] failed to stage OCR assets:', error.message);
  process.exitCode = 1;
});
