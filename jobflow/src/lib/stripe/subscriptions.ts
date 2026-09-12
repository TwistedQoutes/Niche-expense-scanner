import { PlanTier, Prisma, SubscriptionStatus } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { tierForPriceId } from '@/lib/stripe/client';

/**
 * Turning Stripe's events into this product's subscription state.
 *
 * The rule throughout: **a webhook may only ever change the workspace it names.**
 * Every function here resolves an organization from the event and then writes only
 * that row, so a forged or confused event cannot reach across tenants. The
 * unscoped client is used deliberately — Subscription belongs to the tenant rather
 * than living inside it, and there is no signed-in user to scope to.
 */

/** Stripe's subscription statuses, mapped onto ours. */
export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'trialing':
      return SubscriptionStatus.TRIALING;
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'past_due':
      return SubscriptionStatus.PAST_DUE;
    /*
     * Distinct from past-due on purpose: Stripe has given up retrying the card,
     * so this is further along than "a payment bounced". Both fall back to FREE
     * limits, but the billing screen can say which happened — and "we stopped
     * trying" is the one that needs the customer to act.
     */
    case 'unpaid':
      return SubscriptionStatus.UNPAID;
    case 'canceled':
    case 'incomplete_expired':
      return SubscriptionStatus.CANCELED;
    /*
     * `incomplete` means the first payment has not gone through, so the workspace
     * has not actually bought anything yet. Treated as past-due rather than
     * active: it falls back to FREE limits without locking anybody out.
     */
    case 'incomplete':
    case 'paused':
      return SubscriptionStatus.PAST_DUE;
    default:
      // An unrecognised status is not assumed to be good news.
      return SubscriptionStatus.PAST_DUE;
  }
}

function secondsToDate(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : null;
}

/**
 * Finds the workspace an event is about.
 *
 * Metadata first, because it is what we set ourselves at checkout and is the most
 * direct answer. The Stripe customer id is the fallback, for events about a
 * subscription created outside our checkout — someone fixing a plan by hand in the
 * Stripe dashboard.
 *
 * Returns null rather than guessing. An event we cannot attribute is logged and
 * dropped; applying it to an arbitrary workspace would change the wrong
 * customer's plan.
 */
export async function resolveOrganizationId(input: {
  metadataOrganizationId?: unknown;
  clientReferenceId?: unknown;
  stripeCustomerId?: unknown;
}): Promise<string | null> {
  const candidates = [input.metadataOrganizationId, input.clientReferenceId].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  for (const candidate of candidates) {
    // Confirmed against a real row: an id in metadata is only a claim until a
    // workspace with that id is found.
    const organization = await prisma.organization.findUnique({
      where: { id: candidate },
      select: { id: true },
    });
    if (organization) return organization.id;
  }

  if (typeof input.stripeCustomerId === 'string' && input.stripeCustomerId.length > 0) {
    const subscription = await prisma.subscription.findUnique({
      where: { stripeCustomerId: input.stripeCustomerId },
      select: { organizationId: true },
    });
    if (subscription) return subscription.organizationId;
  }

  return null;
}

export type StripeSubscriptionObject = {
  id?: unknown;
  customer?: unknown;
  status?: unknown;
  current_period_start?: unknown;
  current_period_end?: unknown;
  cancel_at_period_end?: unknown;
  canceled_at?: unknown;
  trial_end?: unknown;
  metadata?: { organizationId?: unknown; tier?: unknown } | null;
  items?: { data?: Array<{ price?: { id?: unknown } | null }> | null } | null;
};

/**
 * Applies a subscription's current state to the workspace it belongs to.
 *
 * Written from the subscription object rather than from the event type, because
 * `created`, `updated` and `resumed` all mean the same thing here: this is the
 * state now. That also makes the handler naturally idempotent — applying the same
 * object twice is the same write.
 */
export async function applySubscriptionState(
  subscription: StripeSubscriptionObject,
): Promise<{ organizationId: string; plan: PlanTier } | null> {
  const organizationId = await resolveOrganizationId({
    metadataOrganizationId: subscription.metadata?.organizationId,
    stripeCustomerId: subscription.customer,
  });

  if (!organizationId) return null;

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const tierFromPrice = typeof priceId === 'string' ? tierForPriceId(priceId) : null;

  /*
   * The price decides the plan, and an unrecognised one is not guessed at.
   *
   * Falling back to the tier in metadata would let anyone who can create a
   * subscription with chosen metadata pick their own plan; falling back to
   * BUSINESS would hand out the top tier on a configuration mistake; falling back
   * to FREE would downgrade a paying customer because an environment variable was
   * missing. So the plan is left as it is and the mismatch is logged loudly.
   */
  const existing = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { plan: true },
  });

  if (!tierFromPrice && typeof priceId === 'string') {
    console.error('[stripe] a subscription names a price this deployment does not know', {
      organizationId,
      priceId,
    });
  }

  const plan = tierFromPrice ?? existing?.plan ?? PlanTier.FREE;
  const status = mapStripeStatus(typeof subscription.status === 'string' ? subscription.status : '');

  /*
   * `stripeCustomerId` and `stripeSubscriptionId` are unique across the whole
   * table — one Stripe identity belongs to one workspace — so writing one that
   * another workspace already holds raises P2002.
   *
   * Left unhandled that is a 500, and Stripe retries a failed webhook for days:
   * a single collision would mean every subsequent delivery for that workspace
   * failing too, and eventually the endpoint being disabled. So the collision is
   * detected first, the identifier is simply not claimed, and the plan and status —
   * the part the customer is paying for — are still applied.
   *
   * Not claiming rather than stealing: if two workspaces really do point at one
   * Stripe customer, that is a data problem for a person to resolve, and silently
   * moving the identifier would move the billing relationship with it.
   */
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
  const subscriptionId = typeof subscription.id === 'string' ? subscription.id : null;

  const [customerHeldElsewhere, subscriptionHeldElsewhere] = await Promise.all([
    customerId
      ? prisma.subscription.findFirst({
          where: { stripeCustomerId: customerId, organizationId: { not: organizationId } },
          select: { organizationId: true },
        })
      : null,
    subscriptionId
      ? prisma.subscription.findFirst({
          where: { stripeSubscriptionId: subscriptionId, organizationId: { not: organizationId } },
          select: { organizationId: true },
        })
      : null,
  ]);

  if (customerHeldElsewhere) {
    console.error('[stripe] another workspace already holds this Stripe customer', {
      organizationId,
      stripeCustomerId: customerId,
      heldBy: customerHeldElsewhere.organizationId,
    });
  }

  if (subscriptionHeldElsewhere) {
    console.error('[stripe] another workspace already holds this Stripe subscription', {
      organizationId,
      stripeSubscriptionId: subscriptionId,
      heldBy: subscriptionHeldElsewhere.organizationId,
    });
  }

  const claimableCustomerId = customerHeldElsewhere ? null : customerId;
  const claimableSubscriptionId = subscriptionHeldElsewhere ? null : subscriptionId;

  await prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      plan,
      status,
      stripeCustomerId: claimableCustomerId,
      stripeSubscriptionId: claimableSubscriptionId,
      stripePriceId: typeof priceId === 'string' ? priceId : null,
      currentPeriodStart: secondsToDate(subscription.current_period_start),
      currentPeriodEnd: secondsToDate(subscription.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      canceledAt: secondsToDate(subscription.canceled_at),
      trialEndsAt: secondsToDate(subscription.trial_end),
    },
    update: {
      plan,
      status,
      // `undefined` leaves the column alone; null would clear an identifier this
      // workspace legitimately holds.
      stripeCustomerId: claimableCustomerId ?? undefined,
      stripeSubscriptionId: claimableSubscriptionId ?? undefined,
      stripePriceId: typeof priceId === 'string' ? priceId : undefined,
      currentPeriodStart: secondsToDate(subscription.current_period_start),
      currentPeriodEnd: secondsToDate(subscription.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      canceledAt: secondsToDate(subscription.canceled_at),
      trialEndsAt: secondsToDate(subscription.trial_end),
    },
  });

  return { organizationId, plan };
}

/**
 * A subscription that has ended.
 *
 * The plan is kept on the row rather than reset, so the billing screen can say
 * what they had, and `effectivePlan` already treats a CANCELED subscription as
 * FREE. Nothing is deleted: locking someone out of their own customer list is how
 * a billing problem becomes a cancellation.
 */
export async function applySubscriptionCancelled(
  subscription: StripeSubscriptionObject,
): Promise<string | null> {
  const organizationId = await resolveOrganizationId({
    metadataOrganizationId: subscription.metadata?.organizationId,
    stripeCustomerId: subscription.customer,
  });

  if (!organizationId) return null;

  await prisma.subscription.updateMany({
    where: { organizationId },
    data: {
      status: SubscriptionStatus.CANCELED,
      canceledAt: secondsToDate(subscription.canceled_at) ?? new Date(),
      cancelAtPeriodEnd: false,
    },
  });

  return organizationId;
}

export type StripeInvoiceObject = {
  id?: unknown;
  customer?: unknown;
  number?: unknown;
  amount_due?: unknown;
  amount_paid?: unknown;
  currency?: unknown;
  status?: unknown;
  hosted_invoice_url?: unknown;
  invoice_pdf?: unknown;
  period_start?: unknown;
  period_end?: unknown;
  status_transitions?: { paid_at?: unknown } | null;
  subscription_details?: { metadata?: { organizationId?: unknown } | null } | null;
};

/** Mirrors an invoice so the billing screen has a history without calling Stripe. */
export async function recordInvoice(invoice: StripeInvoiceObject): Promise<string | null> {
  const stripeInvoiceId = typeof invoice.id === 'string' ? invoice.id : null;
  if (!stripeInvoiceId) return null;

  const organizationId = await resolveOrganizationId({
    metadataOrganizationId: invoice.subscription_details?.metadata?.organizationId,
    stripeCustomerId: invoice.customer,
  });

  if (!organizationId) return null;

  /*
   * Typed against Prisma's own input rather than left as a bare object literal.
   * TypeScript only applies excess-property checking to a literal passed directly
   * to a typed parameter, so a misnamed column in a `const` like this one slips
   * past the compiler and fails at runtime instead — which is exactly what
   * happened with `invoicePdfUrl` for `pdfUrl`.
   */
  const data: Prisma.InvoiceUncheckedCreateInput = {
    organizationId,
    stripeInvoiceId,
    number: typeof invoice.number === 'string' ? invoice.number : null,
    amountDueCents: typeof invoice.amount_due === 'number' ? invoice.amount_due : 0,
    amountPaidCents: typeof invoice.amount_paid === 'number' ? invoice.amount_paid : 0,
    currency:
      typeof invoice.currency === 'string' ? invoice.currency.toUpperCase() : 'USD',
    status: typeof invoice.status === 'string' ? invoice.status : 'unknown',
    hostedInvoiceUrl:
      typeof invoice.hosted_invoice_url === 'string' ? invoice.hosted_invoice_url : null,
    pdfUrl: typeof invoice.invoice_pdf === 'string' ? invoice.invoice_pdf : null,
    periodStart: secondsToDate(invoice.period_start),
    periodEnd: secondsToDate(invoice.period_end),
    paidAt: secondsToDate(invoice.status_transitions?.paid_at),
  };

  // Upsert on Stripe's own id, so a retried delivery updates the row rather than
  // creating a second copy of the same invoice.
  await prisma.invoice.upsert({
    where: { stripeInvoiceId },
    create: data,
    update: data,
  });

  return organizationId;
}

/** Marks a workspace past due after a failed payment. */
export async function applyPaymentFailed(invoice: StripeInvoiceObject): Promise<string | null> {
  const organizationId = await resolveOrganizationId({
    metadataOrganizationId: invoice.subscription_details?.metadata?.organizationId,
    stripeCustomerId: invoice.customer,
  });

  if (!organizationId) return null;

  await prisma.subscription.updateMany({
    where: { organizationId },
    data: { status: SubscriptionStatus.PAST_DUE },
  });

  return organizationId;
}
