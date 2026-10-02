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
 * Scales every ceiling below, for deployments where one address is many people.
 *
 * Read once at startup, defaults to 1, and clamped — a typo that multiplies
 * every limit by ten thousand should not be the way you find out.
 *
 * It exists for two reasons, and neither is a backdoor: nothing in a request
 * can change it, and a deployment that does not set it behaves exactly as
 * before.
 *
 *  1. **The end-to-end suite.** It signs up more than forty workspaces from the
 *     runner's single IP, against a production ceiling of twenty an hour. Every
 *     test after the twentieth failed on a 429, which is what red CI looked
 *     like rather than anything the suite was testing.
 *  2. **A shared connection.** The note under these constants already worries
 *     about a crew behind one office NAT. Someone running JobFlow for a
 *     franchise with forty vans on one WAN address has the same problem and now
 *     has a dial, instead of a patched constant.
 *
 * It does not change the *windows*, only the counts, so an attacker still pays
 * the same wall-clock time per attempt.
 */
const MULTIPLIER = (() => {
  const raw = Number(process.env.RATE_LIMIT_MULTIPLIER ?? '1');
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(raw, 100);
})();

/** A rule's ceiling for this deployment. */
export function ceilingFor(rule: RateLimitRule): number {
  return Math.ceil(rule.limit * MULTIPLIER);
}

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
  /**
   * Inviting sends an email to an address the sender types in, which makes it the
   * one authenticated endpoint that can be pointed at a stranger. Keyed by
   * organization, and tight: a crew of five is five invitations, not fifty.
   */
  invite: { name: 'invite', limit: 10, windowSeconds: 3600 },
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
  /**
   * Starting a demo provisions a whole seeded workspace, so it is the cheapest
   * request in the product to abuse and the most expensive to serve. Tight.
   */
  demo: { name: 'demo', limit: 3, windowSeconds: 3600 },
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
  if (existing.count > ceilingFor(rule)) {
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
