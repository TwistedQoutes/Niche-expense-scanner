import { beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/api/errors';
import {
  RATE_LIMITS,
  clientIp,
  enforceRateLimit,
  resetRateLimits,
} from '@/lib/api/rate-limit';

describe('enforceRateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  const rule = { name: 'test', limit: 3, windowSeconds: 60 };

  it('allows up to the limit', () => {
    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      expect(() => enforceRateLimit(rule, 'caller')).not.toThrow();
    }
  });

  it('throws a 429 once the limit is passed', () => {
    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      enforceRateLimit(rule, 'caller');
    }

    try {
      enforceRateLimit(rule, 'caller');
      throw new Error('expected a rate limit error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(429);
      // Without Retry-After the client has no way to back off intelligently.
      expect((error as AppError).retryAfter).toBeGreaterThan(0);
    }
  });

  it('counts each caller separately', () => {
    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      enforceRateLimit(rule, 'caller-a');
    }

    // One business hitting its limit must not lock out another.
    expect(() => enforceRateLimit(rule, 'caller-b')).not.toThrow();
  });

  it('counts each rule separately', () => {
    const other = { name: 'other', limit: 3, windowSeconds: 60 };

    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      enforceRateLimit(rule, 'caller');
    }

    expect(() => enforceRateLimit(other, 'caller')).not.toThrow();
  });
});

describe('the configured rules', () => {
  it('meters everything that costs money per call', () => {
    // SMS, email and model calls are billed by a third party. An unmetered
    // endpoint here is somebody else writing our invoice.
    expect(RATE_LIMITS.ai.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.messaging.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.passwordReset.limit).toBeLessThanOrEqual(10);
  });

  it('limits the public quote endpoints, which take no session', () => {
    // These are the only authenticated-by-nothing surfaces in the product.
    expect(RATE_LIMITS.publicQuote.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.publicQuoteAction.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS.intake.limit).toBeGreaterThan(0);
  });

  it('leaves room for a whole crew behind one office IP', () => {
    // Limits are per IP and an IP is not a person: a lockout mid-morning costs
    // a customer, where a generous ceiling still stops a brute force.
    expect(RATE_LIMITS.login.limit).toBeGreaterThanOrEqual(20);
    expect(RATE_LIMITS.write.limit).toBeGreaterThanOrEqual(100);
  });
});

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '203.0.113.9, 70.41.3.18' },
    });

    expect(clientIp(request)).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-real-ip': '203.0.113.9' },
    });

    expect(clientIp(request)).toBe('203.0.113.9');
  });

  it('degrades to a constant rather than throwing', () => {
    // Everyone then shares one bucket, which is wrong but safe; throwing here
    // would take down every endpoint that rate-limits.
    expect(clientIp(new Request('https://example.com'))).toBe('unknown');
  });
});
