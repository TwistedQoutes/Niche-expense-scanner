import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getEnv, resetEnvCache } from '@/lib/env';

/**
 * The first thing a new developer does, and what it used to cost them.
 *
 * `.env.example` ships every optional key present and empty — `RESEND_API_KEY=""`
 * — and its opening line says to copy it to `.env` and fill in. Doing exactly
 * that made the app refuse to boot: `.optional()` admits `undefined`, not `''`,
 * so eleven integrations nobody had switched on each reported "Too small". The
 * documented first step was the step that broke.
 *
 * Blank now means absent. The other half of that bargain is below: a driver
 * turned *on* without its credentials must still refuse, because a deployment
 * that looks configured and silently is not is the worst of the three states —
 * nobody finds out until a customer does.
 */

const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/jobflow',
  AUTH_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
};

const MANAGED = /^(DATABASE_URL|AUTH_SECRET|EMAIL_DRIVER|SMS_DRIVER|AI_DRIVER|FILE_STORAGE_DRIVER|RESEND_|TWILIO_|OPENAI_|STRIPE_|S3_|GOOGLE_MAPS|CRON_SECRET)/;

let saved: NodeJS.ProcessEnv;

function withEnv(values: Record<string, string>) {
  for (const key of Object.keys(process.env)) {
    if (MANAGED.test(key)) delete process.env[key];
  }
  Object.assign(process.env, REQUIRED, values);
  resetEnvCache();
}

beforeEach(() => {
  saved = { ...process.env };
});

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe('a copied .env.example', () => {
  it('boots with every optional key present and blank', () => {
    withEnv({
      RESEND_API_KEY: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_PHONE_NUMBER: '',
      TWILIO_WEBHOOK_URL: '',
      OPENAI_API_KEY: '',
      GOOGLE_MAPS_API_KEY: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_PRICE_STARTER: '',
      STRIPE_PRICE_PRO: '',
      STRIPE_PRICE_BUSINESS: '',
      CRON_SECRET: '',
      S3_BUCKET: '',
      S3_ENDPOINT: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
    });

    expect(() => getEnv()).not.toThrow();
  });

  it('reads a blank key as absent rather than as an empty secret', () => {
    withEnv({ OPENAI_API_KEY: '', STRIPE_SECRET_KEY: '', GOOGLE_MAPS_API_KEY: '' });
    const env = getEnv();

    // Not `''`. A caller asking "is this configured?" tests for presence, and an
    // empty string is present.
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.GOOGLE_MAPS_API_KEY).toBeUndefined();
  });

  it('still rejects a value that is present and wrong', () => {
    // Blank means absent; it does not mean "skip the rule".
    withEnv({ S3_ENDPOINT: 'not-a-url', FILE_STORAGE_DRIVER: 's3' });
    expect(() => getEnv()).toThrow(/S3_ENDPOINT/);
  });
});

describe('a driver switched on without its credentials', () => {
  it.each([
    ['EMAIL_DRIVER', { EMAIL_DRIVER: 'resend', RESEND_API_KEY: '' }, /RESEND_API_KEY/],
    [
      'SMS_DRIVER',
      { SMS_DRIVER: 'twilio', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: 'x', TWILIO_PHONE_NUMBER: '+15551234567' },
      /TWILIO_ACCOUNT_SID/,
    ],
    ['AI_DRIVER', { AI_DRIVER: 'openai', OPENAI_API_KEY: '' }, /OPENAI_API_KEY/],
    [
      'FILE_STORAGE_DRIVER',
      {
        FILE_STORAGE_DRIVER: 's3',
        S3_BUCKET: '',
        S3_ENDPOINT: 'https://example.invalid',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 'b',
      },
      /S3_BUCKET/,
    ],
  ])('refuses when %s is set but incomplete', (_label, values, expected) => {
    withEnv(values);
    expect(() => getEnv()).toThrow(expected);
  });

  it('refuses a Stripe key with no webhook secret', () => {
    // The webhook is the only thing that grants a paid plan, so an unverified one
    // is an endpoint anyone can use to subscribe themselves.
    withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: '' });
    expect(() => getEnv()).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('accepts a driver that is fully configured', () => {
    withEnv({
      FILE_STORAGE_DRIVER: 's3',
      S3_BUCKET: 'jobflow-photos',
      S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      S3_ACCESS_KEY_ID: 'a',
      S3_SECRET_ACCESS_KEY: 'b',
    });

    expect(() => getEnv()).not.toThrow();
  });
});
