import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { prisma } from '@/lib/db/client';
import { getEnv } from '@/lib/env';
import {
  applyPaymentFailed,
  applySubscriptionCancelled,
  applySubscriptionState,
  recordInvoice,
  type StripeInvoiceObject,
  type StripeSubscriptionObject,
} from '@/lib/stripe/subscriptions';
import { verifyStripeSignature } from '@/lib/stripe/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe's webhook: the only thing in this product that grants a paid plan.
 *
 * Which makes it the highest-value endpoint to forge. A fabricated
 * `customer.subscription.updated` is a free Business plan; a fabricated
 * `customer.subscription.deleted` downgrades a paying customer. So nothing in the
 * body is believed until the signature checks out, and the signature is checked
 * over the **raw bytes** — `request.text()`, never `request.json()`, because
 * re-serialising changes the payload and would make every legitimate webhook fail.
 *
 * Replay is handled twice over, deliberately:
 *
 *  - The signature carries a timestamp with a five-minute tolerance, so a captured
 *    request stops being usable.
 *  - Every processed event id is recorded, so a delivery Stripe legitimately
 *    retries — which it does, on any non-2xx — is not applied a second time.
 *
 * A handled event always returns 200, including one we deliberately ignore.
 * Returning an error for an event type we do not care about makes Stripe retry it
 * for days and eventually disable the endpoint.
 */
export const POST = withRoute(async (request) => {
  enforceRateLimit(RATE_LIMITS.publicQuote, clientIp(request));

  const env = getEnv();

  // The bytes exactly as sent. This has to happen before any parsing.
  const rawBody = await request.text();

  const verification = verifyStripeSignature({
    secret: env.STRIPE_WEBHOOK_SECRET,
    rawBody,
    signatureHeader: request.headers.get('stripe-signature'),
  });

  if (!verification.ok) {
    // Logged because a burst is either a misconfiguration or someone probing;
    // never echoed back, so a prober learns nothing about why.
    console.warn('[stripe] rejected an unverified webhook', { reason: verification.reason });

    /*
     * 400, not 204. Unlike Twilio, where a refusal we have finished with should
     * not be retried, a rejected Stripe webhook usually means our secret is
     * wrong — and Stripe's retries plus its dashboard's failure count are how
     * that gets noticed rather than silently losing every payment event.
     */
    return new Response(JSON.stringify({ error: 'Signature verification failed.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let event: { id?: unknown; type?: unknown; data?: { object?: unknown } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return new Response(JSON.stringify({ error: 'Body was not valid JSON.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const eventId = typeof event.id === 'string' ? event.id : null;
  const eventType = typeof event.type === 'string' ? event.type : null;

  if (!eventId || !eventType) {
    return new Response(JSON.stringify({ error: 'Not a Stripe event.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  /*
   * The idempotency gate, claimed before the work rather than after.
   *
   * Creating the row first means a concurrent duplicate delivery loses the insert
   * and returns early, instead of both passing a "have we seen this?" check and
   * both applying the event. P2002 on the primary key is the signal.
   */
  try {
    await prisma.webhookEvent.create({ data: { id: eventId, type: eventType } });
  } catch (error) {
    const isDuplicate =
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

    if (isDuplicate) {
      // Already handled. 200 so Stripe stops retrying.
      return Response.json({ received: true, duplicate: true });
    }
    throw error;
  }

  const object = event.data?.object ?? {};

  try {
    switch (eventType) {
      /*
       * Checkout finishing is not what grants the plan. The subscription events
       * carry the authoritative state, and they arrive for renewals and changes
       * too — so the plan is applied from one place rather than two that can
       * disagree. This handler exists to link the Stripe customer to the workspace
       * as early as possible.
       */
      case 'checkout.session.completed': {
        const session = object as {
          client_reference_id?: unknown;
          customer?: unknown;
          metadata?: { organizationId?: unknown } | null;
        };

        const organizationId =
          typeof session.metadata?.organizationId === 'string'
            ? session.metadata.organizationId
            : typeof session.client_reference_id === 'string'
              ? session.client_reference_id
              : null;

        if (organizationId && typeof session.customer === 'string') {
          /*
           * `stripeCustomerId` is unique table-wide, so claiming one another
           * workspace holds would raise P2002 — and an unhandled failure here
           * means Stripe retries this delivery for days. The identifier is left
           * alone in that case; the subscription events that follow carry the
           * plan, which is the part that matters.
           */
          const heldElsewhere = await prisma.subscription.findFirst({
            where: {
              stripeCustomerId: session.customer,
              organizationId: { not: organizationId },
            },
            select: { organizationId: true },
          });

          if (heldElsewhere) {
            console.error('[stripe] checkout names a customer another workspace holds', {
              organizationId,
              stripeCustomerId: session.customer,
              heldBy: heldElsewhere.organizationId,
            });
          } else {
            await prisma.subscription.updateMany({
              where: { organizationId },
              data: { stripeCustomerId: session.customer },
            });
          }
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.resumed':
      case 'customer.subscription.paused': {
        const applied = await applySubscriptionState(object as StripeSubscriptionObject);

        if (!applied) {
          console.warn('[stripe] could not attribute a subscription event to a workspace', {
            eventId,
            eventType,
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const organizationId = await applySubscriptionCancelled(object as StripeSubscriptionObject);

        if (!organizationId) {
          console.warn('[stripe] could not attribute a cancellation to a workspace', { eventId });
        }
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded':
      case 'invoice.finalized': {
        await recordInvoice(object as StripeInvoiceObject);
        break;
      }

      case 'invoice.payment_failed': {
        const organizationId = await applyPaymentFailed(object as StripeInvoiceObject);
        await recordInvoice(object as StripeInvoiceObject);

        if (organizationId) {
          await prisma.notification.create({
            data: {
              organizationId,
              userId: null,
              type: 'billing.payment_failed',
              title: 'A payment did not go through',
              body: 'Update the card on file to keep your plan. Nothing has been deleted.',
              href: '/billing',
            },
          });
        }
        break;
      }

      default:
        // Everything else is ignored on purpose, with a 200 — see above.
        break;
    }
  } catch (error) {
    /*
     * The work failed after the event was claimed, so the claim is released: the
     * alternative is an event marked handled that never was, and a workspace
     * stuck on the wrong plan with no retry coming.
     */
    await prisma.webhookEvent.delete({ where: { id: eventId } }).catch(() => {});
    throw error;
  }

  return Response.json({ received: true });
});
