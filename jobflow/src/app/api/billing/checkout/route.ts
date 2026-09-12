import { PlanTier, Role } from '@prisma/client';
import { z } from 'zod';

import { AppError, badGateway, conflict, notImplemented, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { getEnv } from '@/lib/env';
import { StripeError, billingEnabled, createCheckoutSession, priceIdFor } from '@/lib/stripe/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /**
   * FREE is not a checkout. Downgrading to it is a cancellation, which happens in
   * Stripe's portal, so accepting it here would create a checkout for nothing.
   */
  tier: z.enum([PlanTier.STARTER, PlanTier.PRO, PlanTier.BUSINESS]),
});

/**
 * Starts a hosted checkout.
 *
 * OWNER only. This commits the business to a recurring charge, which is not a
 * decision an admin — let alone a crew member — should be able to make on the
 * owner's card.
 *
 * The organization is taken from the verified session, never from the body. That
 * is the whole security property here: a caller cannot buy a plan for, or on
 * behalf of, another workspace.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.OWNER);
  enforceRateLimit(RATE_LIMITS.billing, auth.organization.id);

  if (!billingEnabled()) {
    throw notImplemented(
      'Billing is not configured on this deployment, so there is nothing to buy yet.',
    );
  }

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const priceId = priceIdFor(parsed.data.tier);
  if (!priceId) {
    // A plan with no price configured cannot be sold, and saying so plainly beats
    // a Stripe error about a missing price.
    throw notImplemented(`The ${parsed.data.tier} plan is not available on this deployment.`);
  }

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: auth.organization.id },
    select: { stripeCustomerId: true, trialEndsAt: true, plan: true, status: true },
  });

  const appUrl = getEnv().APP_URL.replace(/\/+$/, '');

  try {
    const session = await createCheckoutSession({
      organizationId: auth.organization.id,
      tier: parsed.data.tier,
      priceId,
      customerEmail: auth.user.email,
      stripeCustomerId: subscription?.stripeCustomerId ?? null,
      successUrl: `${appUrl}/billing?checkout=done`,
      cancelUrl: `${appUrl}/billing?checkout=cancelled`,
      trialEndsAt: subscription?.trialEndsAt ?? null,
    });

    if (!session.url) {
      throw badGateway('Stripe did not return a checkout link. Try again in a moment.');
    }

    return jsonOk({ url: session.url });
  } catch (error) {
    if (error instanceof AppError) throw error;

    if (error instanceof StripeError) {
      // Stripe's own message is shown: it is written for the person paying, and
      // hiding it behind "something went wrong" sends them to support instead.
      throw error.retryable
        ? badGateway(`Stripe is not responding: ${error.message}`)
        : conflict(error.message);
    }

    throw error;
  }
});
