import { PlanTier } from '@prisma/client';

import { PLANS, planFor } from '@/lib/billing/plans';
import { getEnv } from '@/lib/env';

/**
 * Stripe, over plain HTTP.
 *
 * The official SDK is a large dependency for what this product needs: three
 * endpoints, all form-encoded. The same reasoning as the Twilio and Resend
 * drivers — and it keeps the secret key in one file where it is easy to check
 * that it never leaves the server.
 *
 * Nothing here is imported by a client component. The secret key is read through
 * `getEnv()`, which is server-only, and the checkout URL is returned to the
 * browser rather than the key being handed over for the browser to use.
 */

export class StripeError extends Error {
  readonly retryable: boolean;
  readonly stripeCode: string | null;

  constructor(message: string, options: { retryable?: boolean; stripeCode?: string | null } = {}) {
    super(message);
    this.name = 'StripeError';
    this.retryable = options.retryable ?? false;
    this.stripeCode = options.stripeCode ?? null;
  }
}

export function billingEnabled(): boolean {
  const env = getEnv();
  return Boolean(env.STRIPE_SECRET_KEY) && Boolean(env.STRIPE_WEBHOOK_SECRET);
}

/** The configured price id for a tier, or null if that tier is not for sale. */
export function priceIdFor(tier: PlanTier): string | null {
  const plan = planFor(tier);
  if (!plan.stripePriceEnvKey) return null;

  const env = getEnv() as unknown as Record<string, string | undefined>;
  return env[plan.stripePriceEnvKey] ?? null;
}

/**
 * Which tier a Stripe price id belongs to.
 *
 * The reverse lookup matters more than it looks: a webhook arrives naming a price,
 * and this is what decides which plan's limits the workspace gets. An unknown
 * price returns null and the caller refuses to guess — silently defaulting to
 * BUSINESS would hand out the top plan to anyone who could get an unrecognised
 * price through, and defaulting to FREE would downgrade a paying customer because
 * an environment variable was missing.
 */
export function tierForPriceId(priceId: string): PlanTier | null {
  for (const plan of PLANS) {
    if (!plan.stripePriceEnvKey) continue;
    if (priceIdFor(plan.tier) === priceId) return plan.tier;
  }
  return null;
}

/**
 * One form-encoded POST to Stripe.
 *
 * `idempotencyKey` is passed on every mutating call. Stripe treats a repeat with
 * the same key as the same request, which is what stops a double-clicked upgrade
 * button becoming two subscriptions.
 */
async function stripePost<T>(
  path: string,
  params: Record<string, string>,
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const env = getEnv();

  if (!env.STRIPE_SECRET_KEY) {
    throw new StripeError('Billing is not configured on this deployment.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  let response: Response;
  try {
    response = await fetch(`${env.STRIPE_BASE_URL.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        // Basic auth with the secret key as the username, which is Stripe's
        // documented scheme.
        Authorization: `Basic ${Buffer.from(`${env.STRIPE_SECRET_KEY}:`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Pinned, so Stripe changing a default cannot change our behaviour
        // without a deliberate edit here.
        'Stripe-Version': '2024-06-20',
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      body: new URLSearchParams(params),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new StripeError('Stripe timed out.', { retryable: true });
    }
    throw new StripeError('Could not reach Stripe.', { retryable: true });
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string; code?: string; type?: string } }
    | null;

  if (!response.ok) {
    /*
     * 4xx from Stripe is a request we got wrong and retrying will not fix. Only
     * 5xx and 429 are worth another attempt.
     */
    const retryable = response.status >= 500 || response.status === 429;

    throw new StripeError(
      payload?.error?.message ?? `Stripe rejected the request (${response.status}).`,
      { retryable, stripeCode: payload?.error?.code ?? null },
    );
  }

  return payload as T;
}

export type CheckoutSession = { id: string; url: string | null };

/**
 * A hosted checkout page for one workspace and one plan.
 *
 * `client_reference_id` carries the organization id, and it is the only thing
 * tying the completed session back to a workspace. The webhook trusts it because
 * the payload it arrives in was signed by Stripe — never because the browser sent
 * it back.
 */
export async function createCheckoutSession(input: {
  organizationId: string;
  tier: PlanTier;
  priceId: string;
  customerEmail: string | null;
  stripeCustomerId: string | null;
  successUrl: string;
  cancelUrl: string;
  trialEndsAt: Date | null;
}): Promise<CheckoutSession> {
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': '1',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.organizationId,
    'metadata[organizationId]': input.organizationId,
    'metadata[tier]': input.tier,
    // So the subscription object itself carries the workspace, not only the
    // checkout session — later webhooks are about the subscription.
    'subscription_data[metadata][organizationId]': input.organizationId,
    'subscription_data[metadata][tier]': input.tier,
    allow_promotion_codes: 'true',
  };

  /*
   * Reuse the existing Stripe customer when there is one, so a workspace that
   * upgrades, cancels and comes back does not accumulate duplicate customers with
   * their payment history split between them.
   */
  if (input.stripeCustomerId) {
    params.customer = input.stripeCustomerId;
  } else if (input.customerEmail) {
    params.customer_email = input.customerEmail;
  }

  /*
   * Any trial left over is honoured in Stripe, so entering a card early does not
   * cost the customer the days they were promised.
   */
  if (input.trialEndsAt && input.trialEndsAt.getTime() > Date.now()) {
    const daysLeft = Math.ceil((input.trialEndsAt.getTime() - Date.now()) / 86_400_000);
    // Stripe's minimum is one day; anything less is simply no trial.
    if (daysLeft >= 1) params['subscription_data[trial_period_days]'] = String(Math.min(daysLeft, 90));
  }

  return stripePost<CheckoutSession>('/checkout/sessions', params, {
    /*
     * Keyed on the workspace, the plan and the day. A double-clicked button
     * reuses the session rather than opening two; a genuine attempt tomorrow gets
     * a fresh one.
     */
    idempotencyKey: `checkout:${input.organizationId}:${input.tier}:${new Date().toISOString().slice(0, 10)}`,
  });
}

/**
 * A link to Stripe's own billing portal.
 *
 * Card details, cancellation and invoices all live there rather than being
 * rebuilt here. Handling card numbers ourselves would put this product in PCI
 * scope for no benefit to the user.
 */
export async function createPortalSession(input: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  return stripePost<{ url: string }>('/billing_portal/sessions', {
    customer: input.stripeCustomerId,
    return_url: input.returnUrl,
  });
}
