import type Stripe from 'stripe';

import { withRoute } from '@/lib/api/handler';
import { getStripe } from '@/lib/billing/stripe';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Stripe webhook receiver — the only place subscription state is written.
 *
 * Three properties this endpoint must have, in order of how badly it goes wrong
 * without them:
 *
 * 1. **Signature verification.** This route cannot be behind auth, because
 *    Stripe has no session. The HMAC signature is the *only* thing separating a
 *    real payment event from anyone on the internet POSTing "this user paid".
 * 2. **The raw body.** The signature covers the exact bytes sent; parsing to
 *    JSON and re-serialising changes them and the check fails.
 * 3. **Idempotency.** Stripe retries on any non-2xx and can deliver duplicates
 *    regardless, so each event id is recorded and a repeat is a no-op.
 *
 * It also answers 2xx for events it does not care about — a non-2xx tells
 * Stripe to retry forever and eventually disables the endpoint.
 */
export const POST = withRoute(async (request) => {
  const stripe = getStripe();
  const { STRIPE_WEBHOOK_SECRET } = getEnv();

  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    // Billing is off; nothing legitimate can be sending here.
    return new Response('Billing is not enabled.', { status: 404 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature.', { status: 400 });

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    // Deliberately terse: an attacker probing this endpoint learns nothing.
    console.warn('[stripe] rejected a webhook with a bad signature', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return new Response('Invalid signature.', { status: 400 });
  }

  // Idempotency gate. The unique primary key is what makes this atomic: two
  // concurrent deliveries of the same event cannot both win the insert.
  try {
    await prisma.webhookEvent.create({ data: { id: event.id, type: event.type } });
  } catch {
    return Response.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(stripe, event);
  } catch (error) {
    // Roll back the idempotency record so Stripe's retry can have another go —
    // otherwise a transient database failure silently loses a payment event.
    await prisma.webhookEvent.delete({ where: { id: event.id } }).catch(() => {});
    console.error('[stripe] failed to handle an event', { id: event.id, type: event.type, error });
    return new Response('Handler failed.', { status: 500 });
  }

  return Response.json({ received: true });
});

/**
 * Copies the parts of a subscription we mirror locally onto the user row.
 *
 * Returns false when the event carries nothing we can match a user against.
 * That is not an error to retry: no amount of redelivery adds a customer to a
 * payload that never had one, and answering non-2xx to something unprocessable
 * makes Stripe retry it for days and then disable the endpoint — which would
 * take the *real* payment events down with it.
 */
async function applySubscription(subscription: Stripe.Subscription): Promise<boolean> {
  // Signature verification proves Stripe sent these bytes, not that they have
  // the shape the types promise, so the fields are checked before they're read.
  if (typeof subscription !== 'object' || subscription === null) return false;

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : (subscription.customer?.id ?? null);

  // `metadata.userId` is set at checkout; the customer id is the fallback for
  // subscriptions created another way (the Stripe dashboard, say).
  const userId = subscription.metadata?.userId;

  if (!userId && !customerId) return false;

  const where = userId ? { id: userId } : { stripeCustomerId: customerId };

  // `updateMany` rather than `update`: an event for a user we do not have must
  // be a no-op, not a crash that makes Stripe retry forever.
  await prisma.user.updateMany({
    where,
    data: {
      // Only overwrite the stored customer id when this event actually carries
      // one, so a metadata-matched event cannot blank it out.
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: periodEnd(subscription),
    },
  });

  return true;
}

/**
 * The end of the paid period, in whatever shape this API version reports it.
 *
 * Stripe moved this from the subscription to its items; reading both means the
 * handler keeps working across the version change instead of silently writing
 * nulls.
 */
function periodEnd(subscription: Stripe.Subscription): Date | null {
  const candidate =
    (subscription as unknown as { current_period_end?: number }).current_period_end ??
    subscription.items?.data?.[0]?.current_period_end;

  return typeof candidate === 'number' ? new Date(candidate * 1000) : null;
}

async function handleEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (!session?.subscription) return;

      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription.id;

      // The session itself carries no subscription status, so it is fetched —
      // this is the moment access is granted, and it should be right.
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await applySubscription(subscription);
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const applied = await applySubscription(event.data.object);
      if (!applied) {
        console.warn('[stripe] ignored a subscription event with no user to match', {
          id: event.id,
          type: event.type,
        });
      }
      return;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId =
        typeof invoice?.customer === 'string' ? invoice.customer : invoice?.customer?.id;
      if (!customerId) return;

      // Marked past_due, which keeps the account writable while Stripe retries.
      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: { subscriptionStatus: 'past_due' },
      });
      return;
    }

    default:
      // Acknowledged and ignored.
      return;
  }
}
