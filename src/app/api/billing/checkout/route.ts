import { AppError } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { getStripe } from '@/lib/billing/stripe';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Starts a Stripe Checkout session and hands back its URL.
 *
 * Checkout rather than a card form on our own page, deliberately: card details
 * never touch this server, which keeps PCI scope at the smallest possible tier
 * and means a bug in this codebase cannot leak a card number.
 */
export const POST = withRoute(async () => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.billing, user.id);

  const stripe = getStripe();
  const env = getEnv();

  if (!stripe || !env.STRIPE_PRICE_ID) {
    throw new AppError('not_found', 'Billing is not enabled on this installation.');
  }

  // Reuse the customer if we have made one, so a returning subscriber does not
  // accumulate duplicate Stripe customers with split payment history.
  let customerId = user.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.studioName ?? undefined,
      // Lets us find our user from a webhook even if the local row is mid-write.
      metadata: { userId: user.id },
    });
    customerId = customer.id;

    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${env.APP_URL}/settings?checkout=success`,
    cancel_url: `${env.APP_URL}/settings?checkout=cancelled`,
    // Carried through to every webhook this session produces, so the handler
    // never has to guess which account paid.
    client_reference_id: user.id,
    subscription_data: { metadata: { userId: user.id } },
    allow_promotion_codes: true,
    // Stripe Tax: SaaS is taxable in many US states and across the EU. Enabling
    // it here is far cheaper than reconstructing what was owed later.
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto' },
  });

  if (!session.url) {
    throw new AppError('internal_error', 'Stripe did not return a checkout URL.');
  }

  return jsonOk({ url: session.url });
});
