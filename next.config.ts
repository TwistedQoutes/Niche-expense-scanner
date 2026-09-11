import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * The CSP is deliberately self-hosted-only: the OCR engine, its WASM core and
 * the language model are all served from /ocr (see scripts/setup-ocr-assets.mjs),
 * so no third-party CDN needs to be allowlisted.
 *
 * `'unsafe-inline'` for styles and `'unsafe-eval'` for scripts are required by
 * Next's own runtime (styled-jsx, and the dev-mode React refresh transform).
 * Tightening script-src to a per-request nonce is the natural next step once
 * the app moves off the prototype stage.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' blob:",
  // Tesseract runs in a web worker instantiated from a blob URL.
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${
    process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
  }`,
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // OCR assets are content-addressed by version and never change in place.
        source: '/ocr/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
