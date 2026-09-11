import { rateLimited } from '@/lib/api/errors';

/**
 * Fixed-window rate limiter, in memory.
 *
 * Enough to blunt credential stuffing, quote-page scraping and AI-endpoint
 * abuse on a single-node deployment. It is deliberately simple and deliberately
 * per-process: behind more than one instance, swap the counter in `hit()` for
 * Redis/Upstash — the call sites do not change.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

// Bound the map so a flood of unique keys cannot grow it without limit.
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitRule = {
  /** Distinguishes counters for different endpoints. */
  name: string;
  limit: number;
  windowSeconds: number;
};

/**
 * Limits are per IP, and an IP is not a person.
 *
 * A landscaping crew shares one office connection, and several people on one
 * carrier NAT share one address. Limits tight enough to feel safe on paper lock
 * out a whole business mid-morning, and a lockout at the moment someone is
 * quoting a job is a customer lost rather than an attack stopped.
 *
 * So these sit where they still cost an attacker real time — 30 login attempts
 * per five minutes against a 10-character minimum password is not a viable
 * brute force — while leaving room for a shared connection.
 */
export const RATE_LIMITS = {
  login: { name: 'login', limit: 30, windowSeconds: 300 },
  signup: { name: 'signup', limit: 20, windowSeconds: 3600 },
  /** General authenticated writes: leads, customers, quote edits. */
  write: { name: 'write', limit: 240, windowSeconds: 300 },
  read: { name: 'read', limit: 600, windowSeconds: 300 },
  export: { name: 'export', limit: 20, windowSeconds: 300 },
  /**
   * Deliberately tight: every accepted request sends an email, so abuse costs
   * real money and can get the sending domain blocklisted.
   */
  passwordReset: { name: 'password-reset', limit: 5, windowSeconds: 900 },
  billing: { name: 'billing', limit: 20, windowSeconds: 300 },
  /** Each call costs an OpenAI request. Charged per token, so metered hard. */
  ai: { name: 'ai', limit: 30, windowSeconds: 300 },
  /** Outbound SMS and email cost money per message. */
  messaging: { name: 'messaging', limit: 60, windowSeconds: 300 },
  /**
   * The public quote page. Unauthenticated by design — a customer must be able
   * to open it without an account — so it needs its own ceiling to stop someone
   * walking the id space looking for other businesses' quotes.
   */
  publicQuote: { name: 'public-quote', limit: 120, windowSeconds: 300 },
  /** Accepting or declining a quote is a one-time act, not a hot path. */
  publicQuoteAction: { name: 'public-quote-action', limit: 20, windowSeconds: 900 },
  /** The customer intake form is public and writes a lead on every success. */
  intake: { name: 'intake', limit: 10, windowSeconds: 900 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Records a hit and throws `AppError('rate_limited')` once the rule is exceeded.
 * `identifier` should be the most specific thing available — an organization id
 * when the caller is authenticated, otherwise the client IP.
 */
export function enforceRateLimit(rule: RateLimitRule, identifier: string): void {
  const now = Date.now();
  if (windows.size > MAX_TRACKED_KEYS) sweep(now);

  const key = `${rule.name}:${identifier}`;
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return;
  }

  existing.count += 1;
  if (existing.count > rule.limit) {
    throw rateLimited(Math.max(1, Math.ceil((existing.resetAt - now) / 1000)));
  }
}

/** Test-only: forget every counter so cases do not bleed into one another. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy that overwrites it
 * (Vercel, Cloudflare, an ingress you control). Direct-to-internet deployments
 * must not rely on this value for anything but rate limiting.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}
