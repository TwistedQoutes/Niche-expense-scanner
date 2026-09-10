import { z } from 'zod';

/**
 * Server-side environment contract.
 *
 * Validated once, at first import, so a misconfigured deployment fails loudly
 * at boot instead of throwing a confusing error on the first login attempt.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

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

  cached = parsed.data;
  return cached;
}

export const isProduction = () => getEnv().NODE_ENV === 'production';
