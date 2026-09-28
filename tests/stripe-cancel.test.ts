import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvCache } from '@/lib/env';
import { StripeError, cancelSubscriptionNow } from '@/lib/stripe/client';

/**
 * Cancelling a subscription when a workspace is deleted.
 *
 * The step that decides whether deletion may go ahead at all: if this reports
 * success when the subscription is in fact still live, a business is billed
 * every month for a workspace that no longer exists.
 */

const KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_BASE_URL'] as const;
const previous: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of KEYS) previous[key] = process.env[key];
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit';
  delete process.env.STRIPE_BASE_URL;
  resetEnvCache();
});

afterEach(() => {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  vi.unstubAllGlobals();
  resetEnvCache();
});

function stripeReplies(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('cancelSubscriptionNow', () => {
  it('sends DELETE to the subscription, once, under /v1', async () => {
    const fetch = stripeReplies(200, { id: 'sub_123', status: 'canceled' });

    await cancelSubscriptionNow('sub_123');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    // Exactly one /v1: the base URL already carries it.
    expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_123');
    expect(init.method).toBe('DELETE');
  });

  it('treats a subscription Stripe no longer has as already cancelled', async () => {
    stripeReplies(404, { error: { code: 'resource_missing', message: 'No such subscription' } });
    await expect(cancelSubscriptionNow('sub_gone')).resolves.toBeUndefined();
  });

  it('throws on anything else, so deletion stops', async () => {
    stripeReplies(500, { error: { message: 'Stripe is having a moment' } });
    await expect(cancelSubscriptionNow('sub_123')).rejects.toBeInstanceOf(StripeError);
  });

  it('throws on a 404 that is not a missing subscription', async () => {
    // A wrong URL is a 404 too. It must never be mistaken for "already gone".
    stripeReplies(404, { error: { message: 'Unrecognized request URL' } });
    await expect(cancelSubscriptionNow('sub_123')).rejects.toBeInstanceOf(StripeError);
  });

  it('throws when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(cancelSubscriptionNow('sub_123')).rejects.toBeInstanceOf(StripeError);
  });
});
