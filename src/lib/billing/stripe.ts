import Stripe from 'stripe';

import { getEnv } from '@/lib/env';

/**
 * The Stripe client, or null when billing is not configured.
 *
 * Null is a first-class state, not an error. A deployment without Stripe keys —
 * a self-hosted install, or this app before the owner has finished signing up —
 * should still work completely; it simply never charges anyone. Every access
 * check below treats "billing off" as "everything allowed", so forgetting to
 * configure Stripe can never lock artists out of their own records.
 */
let cached: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;

  const { STRIPE_SECRET_KEY } = getEnv();
  cached = STRIPE_SECRET_KEY
    ? new Stripe(STRIPE_SECRET_KEY, {
        // No pinned apiVersion: the SDK's own default is guaranteed to match
        // the types it ships with, and pinning a mismatched one is a runtime
        // error you only discover in production.
        typescript: true,
      })
    : null;

  return cached;
}

export function billingEnabled(): boolean {
  return getStripe() !== null;
}
