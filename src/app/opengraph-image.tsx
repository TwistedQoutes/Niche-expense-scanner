import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

/**
 * The card a link to this site unfurls into.
 *
 * For this business in particular it is not decoration. Quote links, review
 * links and invitations are texted to people, and iMessage, WhatsApp and every
 * social app render the first thing a customer sees of JobFlow from this image
 * — before they have tapped anything. Without one, the preview is a grey box
 * with a URL in it, which reads exactly like the spam texts people have learned
 * to ignore.
 *
 * Rendered once at build time (the file uses no request-time API), so the font
 * is read from the installed package rather than fetched: nothing here depends
 * on the network, and there is no per-request cost.
 */

export const alt = 'JobFlow AI — Turn leads into jobs. Automatically.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const FONT_DIR = join(process.cwd(), 'node_modules/geist/dist/fonts/geist-sans');

const [semibold, regular] = await Promise.all([
  readFile(join(FONT_DIR, 'Geist-SemiBold.ttf')),
  readFile(join(FONT_DIR, 'Geist-Regular.ttf')),
]);

const BRAND = '#059669';
const BRAND_LIGHT = '#34d399';

/**
 * Sets a line as one run of type.
 *
 * Satori lays out every space-separated word as its own box and places the
 * boxes from measured widths, and with Geist those measurements disagree with
 * the drawn glyphs by a few pixels — enough that "Turn  leads" gets a visibly
 * wider gap than "into jobs". Joined by no-break spaces, a line is measured and
 * drawn as a single word, so its spacing is the font's own. The price is that
 * Satori will no longer wrap it, which is why every line here is set by hand.
 */
function line(text: string): string {
  return text.replaceAll(' ', '\u00a0');
}

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          backgroundColor: '#020617',
          backgroundImage:
            'radial-gradient(ellipse 60% 55% at 85% 0%, rgba(16,185,129,0.28), transparent 70%), radial-gradient(ellipse 50% 50% at 0% 100%, rgba(16,185,129,0.12), transparent 70%)',
          fontFamily: 'Geist',
          color: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill={BRAND} />
            <circle cx="9.25" cy="17" r="2.4" fill="#fff" />
            <path
              d="M14 17.25l3.4 3.4L24.25 12"
              fill="none"
              stroke="#fff"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em' }}>
            JobFlow&nbsp;<span style={{ color: BRAND_LIGHT }}>AI</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 88,
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: '-0.04em',
            }}
          >
            <span>{line('Turn leads into jobs.')}</span>
            <span style={{ color: BRAND_LIGHT }}>Automatically.</span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 30,
              fontSize: 30,
              fontWeight: 400,
              color: '#94a3b8',
              lineHeight: 1.35,
            }}
          >
            <span>{line('Missed-call text back, quotes in minutes, automatic follow-up')}</span>
            <span>{line('and job costing — for lawn care and home services.')}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Geist', data: semibold, weight: 600, style: 'normal' },
        { name: 'Geist', data: regular, weight: 400, style: 'normal' },
      ],
    },
  );
}
