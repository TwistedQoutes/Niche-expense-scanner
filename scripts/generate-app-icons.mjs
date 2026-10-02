#!/usr/bin/env node
/**
 * Generates every icon and splash image the two app stores want.
 *
 *   node scripts/generate-app-icons.mjs
 *
 * Run it when the brand mark changes. The output is committed, so a build — or
 * a CI runner, or a contributor without sharp — never has to regenerate it.
 *
 * Three rules shape what comes out, and each is a rejection or a visible defect
 * if you get it wrong:
 *
 *  1. **An iOS app icon may not have an alpha channel.** App Store Connect
 *     rejects the upload, after the build, with a message that does not say
 *     which file. Everything under ios/ is flattened onto the brand colour.
 *
 *  2. **iOS applies its own corner mask.** Baking the rounded corners in gives
 *     a double-rounded icon with pale corners on the home screen, so the iOS
 *     art is a full-bleed square.
 *
 *  3. **Android adaptive icons are cropped by the launcher**, to a circle, a
 *     squircle or whatever the phone's skin prefers. Only the middle ~66% is
 *     guaranteed visible, so the foreground layer is drawn small inside a large
 *     transparent canvas.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The brand. Keep in step with tailwind's brand-600 and capacitor.config.ts. */
const BRAND = '#059669';
const SPLASH_BG = '#f8fafc';

/**
 * The mark alone, on a transparent ground, drawn to fill its viewBox.
 *
 * Separate from public/icon.svg (which is the favicon, with its own rounded
 * plate) so each output can put it on the ground that output needs.
 */
const markSvg = (size, stroke = '#ffffff') => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MARK_BOX}">
  <circle cx="9.25" cy="17" r="2.4" fill="${stroke}"/>
  <path d="M14 17.25l3.4 3.4L24.25 12" fill="none" stroke="${stroke}"
        stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/**
 * A square viewBox around the mark's own ink, not the favicon's 32x32 plate.
 *
 * The plate carries padding that belongs to a rounded-corner favicon. Scaling
 * that whole box leaves the glyph at about 37% of an app icon, which reads as a
 * small logo adrift on a green square. Cropping to the ink and letting each
 * output choose its own padding is what makes the icon look drawn for the size.
 *
 * Ink bounds, stroke width included: x 6.85-25.85, y 10.4-22.25. Squared about
 * that centre (16.35, 16.325) with the wider axis winning.
 */
const MARK_BOX = '6.85 6.825 19 19';

/** A square icon: brand ground, mark centred at `markRatio` of the full size. */
async function squareIcon(size, markRatio = 0.58, background = BRAND) {
  const markSize = Math.round(size * markRatio);
  const offset = Math.round((size - markSize) / 2);

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{ input: Buffer.from(markSvg(markSize)), top: offset, left: offset }])
    .png()
    .toBuffer();
}

/** Flattened to opaque RGB. Required for everything iOS. */
async function opaque(buffer) {
  return sharp(buffer).flatten({ background: BRAND }).removeAlpha().png().toBuffer();
}

/** A transparent canvas with the mark small in the middle, for adaptive layers. */
async function adaptiveForeground(size, innerRatio) {
  const markSize = Math.round(size * innerRatio);
  const offset = Math.round((size - markSize) / 2);

  return sharp({
    create: { width: size, height: size, channels: 4, background: '#00000000' },
  })
    .composite([{ input: Buffer.from(markSvg(markSize)), top: offset, left: offset }])
    .png()
    .toBuffer();
}

/** A splash: the page background, with the brand plate centred. */
async function splash(size) {
  const plate = Math.round(size * 0.18);
  const offset = Math.round((size - plate) / 2);

  const rounded = await sharp({
    create: { width: plate, height: plate, channels: 4, background: '#00000000' },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${plate}" height="${plate}" viewBox="0 0 32 32">
             <rect width="32" height="32" rx="9" fill="${BRAND}"/>
           </svg>`,
        ),
        top: 0,
        left: 0,
      },
      { input: Buffer.from(markSvg(Math.round(plate * 0.58))), gravity: 'center' },
    ])
    .png()
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: SPLASH_BG },
  })
    .composite([{ input: rounded, top: offset, left: offset }])
    .png()
    .toBuffer();
}

async function write(relative, buffer) {
  const target = path.join(ROOT, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
  const kb = (buffer.length / 1024).toFixed(1);
  console.log(`  ${relative.padEnd(62)} ${kb.padStart(7)} KB`);
}

async function main() {
  console.log('\niOS — opaque, square, no baked corners');
  // Xcode 14 and later take one 1024 and derive the rest.
  await write(
    'native/assets/ios/AppIcon-1024.png',
    await opaque(await squareIcon(1024, 0.58)),
  );
  // Capacitor's storyboard scales one image to every device and orientation.
  await write('native/assets/ios/splash-2732.png', await splash(2732));
  await write('native/assets/ios/splash-2732-dark.png', await splash(2732));

  console.log('\nAndroid — legacy launcher icons');
  for (const [density, size] of [
    ['mdpi', 48],
    ['hdpi', 72],
    ['xhdpi', 96],
    ['xxhdpi', 144],
    ['xxxhdpi', 192],
  ]) {
    await write(`native/assets/android/mipmap-${density}/ic_launcher.png`, await squareIcon(size));
    // The round variant for launchers that ask for one by name.
    await write(
      `native/assets/android/mipmap-${density}/ic_launcher_round.png`,
      await squareIcon(size),
    );
  }

  console.log('\nAndroid — adaptive layers (108dp, mark inside the safe 66%)');
  for (const [density, size] of [
    ['mdpi', 108],
    ['hdpi', 162],
    ['xhdpi', 216],
    ['xxhdpi', 324],
    ['xxxhdpi', 432],
  ]) {
    await write(
      `native/assets/android/mipmap-${density}/ic_launcher_foreground.png`,
      // 0.52 of the 108dp canvas is 56dp of ink, inside the 72dp circle every
      // launcher guarantees, with room for the parallax some skins apply.
      await adaptiveForeground(size, 0.52),
    );
  }

  console.log('\nAndroid — splash');
  await write('native/assets/android/splash.png', await splash(2732));
  // Android 12+ draws its own splash: a 960px canvas with the art in the
  // middle 640px, masked to a circle by the system.
  await write('native/assets/android/splash-icon-960.png', await adaptiveForeground(960, 0.5));

  console.log('\nStore listings');
  // Play wants 512 with alpha; App Store Connect takes the 1024 above.
  await write('native/assets/store/play-icon-512.png', await squareIcon(512));

  console.log('\nWeb app manifest — also used when the site is added to a home screen');
  await write('public/icons/icon-192.png', await squareIcon(192));
  await write('public/icons/icon-512.png', await squareIcon(512));
  // Maskable: Android crops this to whatever shape it likes, so the mark is
  // drawn smaller inside a full-bleed brand ground.
  await write('public/icons/icon-maskable-512.png', await squareIcon(512, 0.46));
  // iOS Safari's home-screen icon has no mask and no transparency.
  await write('public/icons/apple-touch-icon-180.png', await opaque(await squareIcon(180, 0.56)));

  console.log('\nDone.\n');
}

await main();
