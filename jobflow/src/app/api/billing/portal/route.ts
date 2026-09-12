import { Role } from '@prisma/client';

import { AppError, badGateway, conflict, notImplemented } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { getEnv } from '@/lib/env';
import { StripeError, billingEnabled, createPortalSession } from '@/lib/stripe/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A link into Stripe's billing portal.
 *
 * Cards, cancellation and receipts all live there. Rebuilding any of it here
 * would mean handling card details, which puts this product in PCI scope for no
 * benefit to anybody.
 *
 * OWNER only, and the customer id comes from this workspace's own subscription
 * row — so the portal link can only ever open this workspace's billing.
 */
export const POST = withRoute(async () => {
  const auth = await requireRole(Role.OWNER);
  enforceRateLimit(RATE_LIMITS.billing, auth.organization.id);

  if (!billingEnabled()) {
    throw notImplemented('Billing is not configured on this deployment.');
  }

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: auth.organization.id },
    select: { stripeCustomerId: true },
  });

  if (!subscription?.stripeCustomerId) {
    throw conflict('There is no billing account yet. Choose a plan first.');
  }

  const appUrl = getEnv().APP_URL.replace(/\/+$/, '');

  try {
    const session = await createPortalSession({
      stripeCustomerId: subscription.stripeCustomerId,
      returnUrl: `${appUrl}/billing`,
    });

    return jsonOk({ url: session.url });
  } catch (error) {
    if (error instanceof AppError) throw error;

    if (error instanceof StripeError) {
      throw error.retryable
        ? badGateway(`Stripe is not responding: ${error.message}`)
        : conflict(error.message);
    }

    throw error;
  }
});
