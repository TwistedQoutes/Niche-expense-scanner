/**
 * The environment the end-to-end suite runs the application in.
 *
 * Three of these specs test things that only exist when an integration is
 * configured — Stripe checkout, the cron-triggered worker, Twilio's inbound
 * webhook — and each of those is guarded by a secret the test itself has to
 * hold in order to produce a valid signature. So the values live here, in one
 * module, read both by `playwright.config.ts` (which passes them to the server
 * it starts) and by the specs (which sign with them). A copy in the CI workflow
 * and another in a spec would drift, and the failure when they do is a 400 that
 * looks like a real bug.
 *
 * **None of these are credentials.** They are placeholders, and deliberately
 * obvious about it. Nothing here reaches a real service:
 *
 *  - `SMS_DRIVER` and `EMAIL_DRIVER` are `none`, so no message can leave a test
 *    run however the specs provoke the product. Messages are recorded as QUEUED,
 *    which is what the specs assert against.
 *  - `STRIPE_BASE_URL` points at a stub the billing spec runs on loopback, so a
 *    checkout is a real HTTP round trip that never leaves the machine.
 *  - The Maps key only makes the address field render as a combobox; that spec
 *    intercepts the application's own endpoint in the browser.
 */

/** Where the billing spec's stub Stripe listens. */
export const STRIPE_STUB_PORT = 4242;

/** The origin the application is served on during a test run. */
export const E2E_ORIGIN = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

export const E2E_ENV = {
  // No outbound message can leave a test run.
  SMS_DRIVER: 'none',
  EMAIL_DRIVER: 'none',

  GOOGLE_MAPS_API_KEY: 'e2e-placeholder-not-a-real-credential',

  // Billing. The secret key is never used against Stripe — every call goes to
  // the stub on loopback — and the webhook secret is what the billing spec signs
  // its webhooks with.
  STRIPE_SECRET_KEY: 'sk_test_e2e-placeholder-not-a-real-credential',
  STRIPE_WEBHOOK_SECRET: 'whsec_e2e-placeholder-not-a-real-credential',
  STRIPE_PRICE_STARTER: 'price_e2e_starter',
  STRIPE_PRICE_PRO: 'price_e2e_pro',
  STRIPE_PRICE_BUSINESS: 'price_e2e_business',
  STRIPE_BASE_URL: `http://127.0.0.1:${STRIPE_STUB_PORT}`,

  // The automation worker's trigger. Without it the endpoint is disabled, which
  // is itself one of the things the worker spec asserts.
  CRON_SECRET: 'e2e-cron-secret-not-a-real-credential',

  /*
   * Twilio's inbound webhook. The auth token is what the missed-call spec signs
   * with, and the URL is the one the signature is computed over — Twilio signs
   * the address it was configured to call, not the address the request arrives
   * at, so this has to match exactly.
   *
   * SMS_DRIVER stays `none`: the token verifies what comes *in*, and nothing
   * goes out.
   */
  TWILIO_AUTH_TOKEN: 'e2e-twilio-token-not-a-real-credential',
  TWILIO_WEBHOOK_URL: `${E2E_ORIGIN}/api/webhooks/twilio`,
} as const;
