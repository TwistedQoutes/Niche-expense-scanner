import { z } from 'zod';

/**
 * Server-side environment contract.
 *
 * Validated once, at first import, so a misconfigured deployment fails loudly
 * at boot instead of throwing a confusing error on the first login attempt.
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
   * Connections per instance. Small on purpose — see src/lib/db.ts. Raise it
   * only on a long-lived server with a connection limit to spare.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),

  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters — generate one with `openssl rand -base64 48`'),

  SESSION_MAX_AGE: z.coerce
    .number()
    .int()
    .positive()
    .max(60 * 60 * 24 * 30)
    .default(60 * 60 * 24 * 7),

  RECEIPT_STORAGE_DRIVER: z.enum(['none', 'local']).default('none'),

  /**
   * Transactional email. "none" logs messages to the server console instead of
   * sending them, which is right for local development and loud enough in
   * production logs that a missing key gets noticed.
   */
  EMAIL_DRIVER: z.enum(['none', 'resend']).default('none'),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default('Niche Expense Scanner <onboarding@resend.dev>'),

  /**
   * Public origin, used to build links in emails and to redirect back from
   * Stripe. Emails contain absolute URLs, so this cannot be inferred from a
   * request that a background job does not have.
   */
  APP_URL: z.string().url().default('http://localhost:3000'),

  // --- Billing -------------------------------------------------------------
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** The recurring price the checkout session subscribes the customer to. */
  STRIPE_PRICE_ID: z.string().min(1).optional(),
  /** Days of full access before payment is required. */
  TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  /** Human label for the subscribe button. Must match the Stripe price. */
  PRICE_LABEL: z.string().default('$7/month'),

  /** Shown in the terms and privacy policy as the contact of record. */
  SUPPORT_EMAIL: z.string().default('support@example.com'),
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

  // Cross-field rules: a driver switched on without its credentials is a
  // deployment that looks configured and silently is not.
  const value = parsed.data;
  const missing: string[] = [];

  if (value.EMAIL_DRIVER === 'resend' && !value.RESEND_API_KEY) {
    missing.push('RESEND_API_KEY is required when EMAIL_DRIVER is "resend"');
  }
  if (value.STRIPE_SECRET_KEY && !value.STRIPE_PRICE_ID) {
    missing.push('STRIPE_PRICE_ID is required when STRIPE_SECRET_KEY is set');
  }
  if (value.STRIPE_SECRET_KEY && !value.STRIPE_WEBHOOK_SECRET) {
    missing.push('STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set');
  }

  if (missing.length > 0) {
    throw new Error(`Invalid environment configuration:\n${missing.map((m) => `  - ${m}`).join('\n')}`);
  }

  cached = value;
  return cached;
}

/** Test seam: forces the environment to be re-read and re-validated. */
export function __resetEnv(): void {
  cached = null;
}

export const isProduction = () => getEnv().NODE_ENV === 'production';
