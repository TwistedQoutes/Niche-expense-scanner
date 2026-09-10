import { rateLimited } from '@/lib/api/errors';

/**
 * Fixed-window rate limiter, in memory.
 *
 * Enough to blunt credential stuffing and OCR-endpoint abuse on a single-node
 * prototype. It is deliberately simple and deliberately per-process: behind
 * more than one instance, swap `hit()` for a Redis/Upstash counter — the call
 * sites do not change.
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

export const RATE_LIMITS = {
  login: { name: 'login', limit: 8, windowSeconds: 300 },
  signup: { name: 'signup', limit: 5, windowSeconds: 3600 },
  parse: { name: 'parse', limit: 60, windowSeconds: 300 },
  write: { name: 'write', limit: 120, windowSeconds: 300 },
  export: { name: 'export', limit: 20, windowSeconds: 300 },
  /**
   * Deliberately tight: every accepted request sends an email, so abuse costs
   * real money and can get the sending domain blocklisted.
   */
  passwordReset: { name: 'password-reset', limit: 5, windowSeconds: 900 },
  billing: { name: 'billing', limit: 20, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Records a hit and throws `AppError('rate_limited')` once the rule is exceeded.
 * `identifier` should be the most specific thing available — a user id when the
 * caller is authenticated, otherwise the client IP.
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

/** Test seam: drops every counter. */
export function __resetRateLimits(): void {
  windows.clear();
}
