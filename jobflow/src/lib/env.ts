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
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default('JobFlow AI <onboarding@resend.dev>'),

  // --- SMS -----------------------------------------------------------------
  SMS_DRIVER: z.enum(['none', 'twilio']).default('none'),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_PHONE_NUMBER: z.string().min(1).optional(),

  // --- AI ------------------------------------------------------------------
  AI_DRIVER: z.enum(['none', 'openai']).default('none'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // --- Maps ----------------------------------------------------------------
  /**
   * Server-side key, used for Geocoding. Kept distinct from the browser key
   * because the two need different API restrictions: the browser key is
   * referrer-locked and visible in page source, this one must never be.
   */
  GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),

  // --- Billing -------------------------------------------------------------
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_STARTER: z.string().min(1).optional(),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  STRIPE_PRICE_BUSINESS: z.string().min(1).optional(),
  /** Days of full PRO access a new workspace gets before a card is required. */
  TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),

  /**
   * Shared secret for the automation worker endpoint. Without it,
   * /api/cron/automations refuses to run — an unauthenticated endpoint that
   * sends SMS on demand is someone else's marketing budget.
   */
  CRON_SECRET: z.string().min(16).optional(),

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
};

export function getPublicConfig(): PublicConfig {
  const trialDays = Number.parseInt(process.env.TRIAL_DAYS ?? '', 10);

  return {
    supportEmail: process.env.SUPPORT_EMAIL || 'support@jobflow.ai',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
    trialDays: Number.isFinite(trialDays) && trialDays >= 0 ? trialDays : 14,
    googleMapsBrowserKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || null,
    stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
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
