import { defineConfig, devices } from '@playwright/test';

import { E2E_ENV } from './tests/e2e/environment';

/**
 * End-to-end tests, against a real build and a real database.
 *
 * These are deliberately few. The unit suite already covers the arithmetic, the
 * validation and the pure logic; what it cannot cover is whether the pieces are
 * wired together — whether a signed-up owner can actually reach the board, whether
 * a customer with no account can accept a quote, and whether one business can see
 * another's data through a real browser with real cookies.
 *
 * They run against `next start`, not `next dev`: a production build is what
 * ships, and the two differ in caching, error handling and how server components
 * are rendered.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Each spec signs up its own workspace, so they cannot collide.
  fullyParallel: true,
  // A test that only passes on a retry is a flaky test, and a flaky suite is one
  // nobody reads. Locally it fails; CI retries once to absorb runner noise.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    /*
     * Chromium is already on the machine in this project's container. Point
     * Playwright at it rather than downloading a second copy; `PLAYWRIGHT_*`
     * environment variables handle it elsewhere.
     */
    ...(process.env.E2E_CHROMIUM ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM } } : {}),
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    /*
     * A phone, because that is where this product is actually used — an owner
     * between jobs, one-handed, in a truck. A layout that only works at 1280px
     * is a layout that does not work.
     */
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  /*
   * Started only when one is not already running, so a developer with `npm start`
   * open in another terminal is not fought with.
   */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://127.0.0.1:3000/api/health',
        // Locally, reuse whatever is already running rather than fighting it for
        // the port. In CI there should be nothing to reuse, and silently
        // adopting a stray server would test something other than this commit.
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        /*
         * The integrations the suite needs configured, as placeholders — see
         * tests/e2e/environment.ts, which the specs read the same values from so
         * that a webhook they sign is a webhook this server will accept.
         *
         * Pointing an existing server at a different set is the one way to get a
         * confusing failure here, which is why `E2E_BASE_URL` (a server you
         * started yourself) needs the same values exported.
         */
        env: { ...E2E_ENV },
      },
});
