import { AppError } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { getStripe } from '@/lib/billing/stripe';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Opens Stripe's customer portal.
 *
 * This is where a subscriber updates their card, downloads invoices, and —
 * importantly — cancels without emailing anyone. Making cancellation easy is
 * both a consumer-protection requirement in several jurisdictions and the
 * cheapest way to avoid disputes.
 */
export const POST = withRoute(async () => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.billing, user.id);

  const stripe = getStripe();
  if (!stripe) throw new AppError('not_found', 'Billing is not enabled on this installation.');

  if (!user.stripeCustomerId) {
    throw new AppError('bad_request', "There's no billing account to manage yet.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${getEnv().APP_URL}/settings`,
  });

  return jsonOk({ url: session.url });
});
