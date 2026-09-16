import { z } from 'zod';

/**
 * Server-side environment contract.
 *
 * Validated on first use rather than at import, so a misconfigured deployment
 * fails loudly on the first request that needs a service — not during
 * `next build`, which should compile code and not require production secrets.
 *
 * Every integration is optional and independently switchable. JobFlow has to be
 * useful to a lawn-care operator who has signed up for nothing but a database:
 * quotes, the pipeline and the CRM all work with OpenAI, Stripe, Twilio, Resend
 * and Google Maps unset. Each one turns on a feature; none of them gates the
 * core product.
 */
/**
 * An optional setting, where blank means absent.
 *
 * `.env.example` ships every optional key present and empty — `RESEND_API_KEY=""`
 * — and its first line tells you to copy it to `.env` and fill in. Doing exactly
 * that used to make the app refuse to boot, because `.optional()` admits
 * `undefined` and not `''`, so eleven integrations nobody had asked for each
 * reported "Too small: expected string to have >=1 characters". The first thing a
 * new developer did was the thing that broke.
 *
 * A key left blank in a template means "I am not using this". Treating it as
 * absent is what the person typing it meant, and it costs nothing: a real value
 * still has to satisfy the rule behind it.
 */
function blankAsAbsent<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres:// connection string',
    ),

  /**
   * Connections per instance. Small on purpose: serverless platforms run many
   * short-lived instances, and each holding a large pool exhausts a managed
   * Postgres' connection limit long before the app is actually busy. Point
   * DATABASE_URL at a pooled endpoint (pgBouncer, Neon `-pooler`, Supabase
   * port 6543) in production and this stays comfortable.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),

  AUTH_SECRET: z
    .string()
    .min(
      32,
      'AUTH_SECRET must be at least 32 characters — generate one with `openssl rand -base64 48`',
    ),

  SESSION_MAX_AGE: z.coerce
    .number()
    .int()
    .positive()
    .max(60 * 60 * 24 * 30)
    .default(60 * 60 * 24 * 7),

  /**
   * Public origin. Quote links, review links and password-reset links are
   * absolute URLs sent by email and SMS, and a background job has no request to
   * infer the host from.
   */
  APP_URL: z.string().url().default('http://localhost:3000'),

  // --- Email ---------------------------------------------------------------
  /** "none" logs messages to the server console instead of sending them. */
  EMAIL_DRIVER: z.enum(['none', 'resend']).default('none'),
  RESEND_API_KEY: blankAsAbsent(z.string().min(1)),
  EMAIL_FROM: z.string().default('JobFlow AI <onboarding@resend.dev>'),

  // --- SMS -----------------------------------------------------------------
  SMS_DRIVER: z.enum(['none', 'twilio']).default('none'),
  TWILIO_ACCOUNT_SID: blankAsAbsent(z.string().min(1)),
  TWILIO_AUTH_TOKEN: blankAsAbsent(z.string().min(1)),
  TWILIO_PHONE_NUMBER: blankAsAbsent(z.string().min(1)),
  /** Overridable for the same reasons as OPENAI_BASE_URL: proxies and testing. */
  TWILIO_BASE_URL: z.string().url().default('https://api.twilio.com/2010-04-01'),
  /**
   * The public URL Twilio posts to, used when verifying its signature.
   *
   * Twilio signs the exact URL it was configured with. Behind a proxy or a
   * tunnel the incoming request's own host can differ from that, and verifying
   * against the wrong URL rejects every legitimate webhook. Set this explicitly
   * in production; it falls back to APP_URL.
   */
  TWILIO_WEBHOOK_URL: blankAsAbsent(z.string().url()),

  // --- AI ------------------------------------------------------------------
  AI_DRIVER: z.enum(['none', 'openai']).default('none'),
  OPENAI_API_KEY: blankAsAbsent(z.string().min(1)),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  /**
   * Where the chat-completions endpoint lives.
   *
   * Overridable because "OpenAI-compatible" is now a category rather than one
   * vendor: Azure OpenAI, a corporate egress proxy, and a self-hosted gateway
   * all speak this API at a different host, and a business with a procurement
   * department will have one of them. Defaults to OpenAI itself.
   */
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  // --- Maps ----------------------------------------------------------------
  /**
   * Server-side key, used for Geocoding. Kept distinct from the browser key
   * because the two need different API restrictions: the browser key is
   * referrer-locked and visible in page source, this one must never be.
   */
  /**
   * Where uploaded job photos are stored.
   *
   * "none" by default: a deployment that has not decided where photographs of
   * customers' properties should live must not start writing them somewhere by
   * accident. "local" writes to disk, which is right on a long-lived server and
   * wrong on a serverless one, where the filesystem is per-invocation and a photo
   * uploaded on one request is gone by the next. "s3" is anything speaking the S3
   * protocol — AWS, Cloudflare R2, Backblaze B2, MinIO.
   */
  FILE_STORAGE_DRIVER: z.enum(['none', 'local', 's3']).default('none'),

  /** Outside the served directory on purpose: these are not public files. */
  FILE_STORAGE_DIR: z.string().default('.storage'),

  S3_BUCKET: blankAsAbsent(z.string().min(1)),
  S3_REGION: z.string().default('auto'),
  /** Include the scheme. R2: https://<account>.r2.cloudflarestorage.com */
  S3_ENDPOINT: blankAsAbsent(z.string().url()),
  S3_ACCESS_KEY_ID: blankAsAbsent(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: blankAsAbsent(z.string().min(1)),

  /**
   * Geocoding and drive time. Server-side only — it must never reach the browser.
   */
  GOOGLE_MAPS_API_KEY: blankAsAbsent(z.string().min(1)),

  // --- Billing -------------------------------------------------------------
  STRIPE_SECRET_KEY: blankAsAbsent(z.string().min(1)),
  STRIPE_WEBHOOK_SECRET: blankAsAbsent(z.string().min(1)),
  STRIPE_PRICE_STARTER: blankAsAbsent(z.string().min(1)),
  STRIPE_PRICE_PRO: blankAsAbsent(z.string().min(1)),
  STRIPE_PRICE_BUSINESS: blankAsAbsent(z.string().min(1)),
  /** Overridable for the same reason as the other base URLs: proxies and tests. */
  STRIPE_BASE_URL: z.string().url().default('https://api.stripe.com/v1'),
  /** Days of full PRO access a new workspace gets before a card is required. */
  TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),

  /**
   * Whether a visitor can spin up a seeded demo workspace without signing up.
   *
   * Off unless switched on. It creates real rows in the real database, and a
   * deployment that did not ask for it should not have an unauthenticated route
   * that writes.
   */
  DEMO_MODE: z
    .enum(['on', 'off'])
    .default('off')
    .transform((value) => value === 'on'),
  /** How long a demo workspace lives before the daily sweep removes it. */
  DEMO_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),

  /**
   * Shared secret for the automation worker endpoint. Without it,
   * /api/cron/automations refuses to run — an unauthenticated endpoint that
   * sends SMS on demand is someone else's marketing budget.
   */
  CRON_SECRET: blankAsAbsent(z.string().min(16)),

  SUPPORT_EMAIL: z.string().default('support@jobflow.ai'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Deliberately not logging the values themselves — only which keys failed.
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  // Cross-field rules. A driver switched on without its credentials is a
  // deployment that looks configured and silently is not — the worst of the
  // three states, because nobody finds out until a customer does.
  const value = parsed.data;
  const missing: string[] = [];

  if (value.EMAIL_DRIVER === 'resend' && !value.RESEND_API_KEY) {
    missing.push('RESEND_API_KEY is required when EMAIL_DRIVER is "resend"');
  }
  if (value.SMS_DRIVER === 'twilio') {
    if (!value.TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID is required when SMS_DRIVER is "twilio"');
    if (!value.TWILIO_AUTH_TOKEN) missing.push('TWILIO_AUTH_TOKEN is required when SMS_DRIVER is "twilio"');
    if (!value.TWILIO_PHONE_NUMBER) missing.push('TWILIO_PHONE_NUMBER is required when SMS_DRIVER is "twilio"');
  }
  if (value.AI_DRIVER === 'openai' && !value.OPENAI_API_KEY) {
    missing.push('OPENAI_API_KEY is required when AI_DRIVER is "openai"');
  }
  if (value.STRIPE_SECRET_KEY && !value.STRIPE_WEBHOOK_SECRET) {
    missing.push('STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set');
  }
  if (value.FILE_STORAGE_DRIVER === 's3') {
    if (!value.S3_BUCKET) missing.push('S3_BUCKET is required when FILE_STORAGE_DRIVER is "s3"');
    if (!value.S3_ENDPOINT) missing.push('S3_ENDPOINT is required when FILE_STORAGE_DRIVER is "s3"');
    if (!value.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID is required when FILE_STORAGE_DRIVER is "s3"');
    if (!value.S3_SECRET_ACCESS_KEY) {
      missing.push('S3_SECRET_ACCESS_KEY is required when FILE_STORAGE_DRIVER is "s3"');
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${missing.map((entry) => `  - ${entry}`).join('\n')}`,
    );
  }

  cached = value;
  return cached;
}

/** Test-only: forget the memoised value so a case can vary the environment. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Display-only configuration, read without validation.
 *
 * `getEnv()` is strict on purpose: a missing `DATABASE_URL` should stop the
 * server. But that strictness is wrong for a statically rendered marketing page
 * that only needs a support address — those have sensible defaults, contain no
 * secrets, and demanding a database URL to render the pricing table would make
 * the build depend on production credentials.
 */
export type PublicConfig = {
  supportEmail: string;
  appUrl: string;
  trialDays: number;
  /** Browser-safe Maps key. Referrer-restricted in the Google console. */
  googleMapsBrowserKey: string | null;
  stripePublishableKey: string | null;
  /** Whether the landing page should offer a demo. */
  demoMode: boolean;
};

export function getPublicConfig(): PublicConfig {
  const trialDays = Number.parseInt(process.env.TRIAL_DAYS ?? '', 10);

  return {
    supportEmail: process.env.SUPPORT_EMAIL || 'support@jobflow.ai',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    trialDays: Number.isFinite(trialDays) && trialDays >= 0 ? trialDays : 14,
    googleMapsBrowserKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null,
    stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
    // Read from the raw variable rather than through getEnv(), because the
    // landing page is statically rendered and must not pull in the server schema.
    demoMode: process.env.DEMO_MODE === 'on',
  };
}

/** Which optional integrations this deployment can actually use. */
export function features() {
  const env = getEnv();
  return {
    email: env.EMAIL_DRIVER === 'resend',
    sms: env.SMS_DRIVER === 'twilio',
    ai: env.AI_DRIVER === 'openai',
    maps: Boolean(env.GOOGLE_MAPS_API_KEY),
    billing: Boolean(env.STRIPE_SECRET_KEY),
  } as const;
}
