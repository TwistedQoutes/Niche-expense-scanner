import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * The policy allows exactly what the product needs and nothing else. Two
 * allowances are worth naming:
 *
 *  - Google Maps is permitted in `script-src`, `img-src` and `connect-src`
 *    because the property map runs in the browser. It is scoped to Google's own
 *    hosts rather than a wildcard.
 *  - `'unsafe-inline'` for styles and `'unsafe-eval'` in development are
 *    required by Next's own runtime (styled-jsx, and the React refresh
 *    transform). Tightening `script-src` to a per-request nonce is the natural
 *    next step once the app leaves MVP.
 *
 * Stripe is not listed: checkout is a full-page redirect to Stripe's domain
 * rather than an embedded element, so no third-party frame or script is loaded
 * here. Add `js.stripe.com` and `frame-src https://js.stripe.com` if you ever
 * switch to embedded Elements.
 */
const isDevelopment = process.env.NODE_ENV === 'development';

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  // A quote page must not be embeddable: framing it is how a customer is
  // tricked into clicking Accept on someone else's site.
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.ggpht.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://maps.googleapis.com",
  "worker-src 'self' blob:",
  `script-src 'self' 'unsafe-inline' https://maps.googleapis.com${
    isDevelopment ? " 'unsafe-eval'" : ''
  }`,
  'upgrade-insecure-requests',
].join('; ');

const nextConfig: NextConfig = {
  /**
   * This app lives in a subdirectory of a repository that contains another one,
   * so Turbopack finds two lockfiles and has to guess which is the root. Saying
   * so explicitly stops it inferring the parent and pulling in files that are
   * not part of JobFlow.
   */
  turbopack: {
    root: import.meta.dirname,
  },

  reactStrictMode: true,
  // Removes the `x-powered-by: Next.js` header. Version disclosure is free
  // reconnaissance for anyone scanning for a known framework bug.
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
            // Geolocation is allowed on our own origin: "use my current
            // location" on the property form is a real feature. Camera is too,
            // for job photos. Microphone has no use here.
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(self)',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
