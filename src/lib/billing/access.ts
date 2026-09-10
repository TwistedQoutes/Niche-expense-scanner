import { billingEnabled } from '@/lib/billing/stripe';
import { getEnv } from '@/lib/env';

/**
 * What an account is currently allowed to do.
 *
 * The rule the whole product hangs on: **an artist never loses access to
 * records they already created.** A lapsed card stops them adding *new*
 * expenses; it never locks them out of last year's receipts at tax time.
 *
 * That is partly decency and partly self-interest — holding someone's tax
 * substantiation hostage is how you earn chargebacks and a reputation among a
 * community that all know each other.
 */

export type BillingStatus =
  | 'billing_disabled'
  | 'trialing'
  | 'subscribed'
  | 'trial_expired'
  | 'past_due'
  | 'canceled';

export type AccessState = {
  /** May they record new expenses? Reading and exporting are always allowed. */
  canWrite: boolean;
  status: BillingStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** Whole days of trial left, floored at 0. Null when not on a trial. */
  trialDaysLeft: number | null;
};

/** Stripe statuses that mean the customer is paid up (or in Stripe's own trial). */
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/** Paid but the latest charge failed. Stripe keeps retrying, so keep them working. */
const GRACE_STATUSES = new Set(['past_due']);

export type BillingFields = {
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
};

export function evaluateAccess(user: BillingFields, now: Date = new Date()): AccessState {
  // No Stripe configured: the app is free and fully functional.
  if (!billingEnabled()) {
    return {
      canWrite: true,
      status: 'billing_disabled',
      trialEndsAt: null,
      currentPeriodEnd: null,
      trialDaysLeft: null,
    };
  }

  const trialEndsAt = user.trialEndsAt;
  const trialActive = trialEndsAt !== null && trialEndsAt.getTime() > now.getTime();
  const trialDaysLeft = trialActive
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    : null;

  const status = user.subscriptionStatus;

  if (status !== null && ACTIVE_STATUSES.has(status)) {
    return {
      canWrite: true,
      status: 'subscribed',
      trialEndsAt,
      currentPeriodEnd: user.currentPeriodEnd,
      trialDaysLeft: null,
    };
  }

  // A failed payment keeps working while Stripe retries. Cutting someone off
  // the hour their card expires is a support ticket, not a collection strategy.
  if (status !== null && GRACE_STATUSES.has(status)) {
    return {
      canWrite: true,
      status: 'past_due',
      trialEndsAt,
      currentPeriodEnd: user.currentPeriodEnd,
      trialDaysLeft: null,
    };
  }

  if (trialActive) {
    return {
      canWrite: true,
      status: 'trialing',
      trialEndsAt,
      currentPeriodEnd: null,
      trialDaysLeft,
    };
  }

  return {
    canWrite: false,
    status: status === 'canceled' ? 'canceled' : 'trial_expired',
    trialEndsAt,
    currentPeriodEnd: user.currentPeriodEnd,
    trialDaysLeft: null,
  };
}

/** The trial window handed to a brand-new account. */
export function trialEndsFromNow(now: Date = new Date()): Date {
  const days = getEnv().TRIAL_DAYS;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
