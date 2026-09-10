import { afterEach, describe, expect, it, vi } from 'vitest';

import { evaluateAccess, trialEndsFromNow } from '@/lib/billing/access';

/**
 * `evaluateAccess` reads `billingEnabled()`, which reads the environment. The
 * module is mocked so each case can state exactly which world it is testing
 * rather than depending on how the suite happens to be configured.
 */
vi.mock('@/lib/billing/stripe', () => ({
  billingEnabled: () => billingOn,
}));

let billingOn = true;

afterEach(() => {
  billingOn = true;
});

const NOW = new Date('2026-09-10T12:00:00Z');
const inDays = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

const account = (over: Partial<Parameters<typeof evaluateAccess>[0]> = {}) => ({
  subscriptionStatus: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  ...over,
});

describe('evaluateAccess — billing switched off', () => {
  it('allows everything, so a missing Stripe key never locks anyone out', () => {
    billingOn = false;
    const access = evaluateAccess(account({ trialEndsAt: inDays(-100) }), NOW);
    expect(access.canWrite).toBe(true);
    expect(access.status).toBe('billing_disabled');
  });
});

describe('evaluateAccess — trials', () => {
  it('allows writing during the trial', () => {
    const access = evaluateAccess(account({ trialEndsAt: inDays(5) }), NOW);
    expect(access.canWrite).toBe(true);
    expect(access.status).toBe('trialing');
    expect(access.trialDaysLeft).toBe(5);
  });

  it('blocks writing once the trial has passed', () => {
    const access = evaluateAccess(account({ trialEndsAt: inDays(-1) }), NOW);
    expect(access.canWrite).toBe(false);
    expect(access.status).toBe('trial_expired');
  });

  it('treats the exact expiry moment as expired', () => {
    expect(evaluateAccess(account({ trialEndsAt: NOW }), NOW).canWrite).toBe(false);
  });

  it('blocks an account that never had a trial', () => {
    expect(evaluateAccess(account(), NOW).canWrite).toBe(false);
  });

  it('rounds part-days up, so "1 day left" never reads as 0', () => {
    const access = evaluateAccess(
      account({ trialEndsAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000) }),
      NOW,
    );
    expect(access.trialDaysLeft).toBe(1);
  });
});

describe('evaluateAccess — subscriptions', () => {
  it('allows writing while active', () => {
    const access = evaluateAccess(
      account({ subscriptionStatus: 'active', currentPeriodEnd: inDays(20) }),
      NOW,
    );
    expect(access.canWrite).toBe(true);
    expect(access.status).toBe('subscribed');
  });

  it("allows writing during Stripe's own trial status", () => {
    expect(evaluateAccess(account({ subscriptionStatus: 'trialing' }), NOW).canWrite).toBe(true);
  });

  it('outlives an expired local trial', () => {
    // Someone who subscribed before their trial ran out must not be cut off.
    const access = evaluateAccess(
      account({ subscriptionStatus: 'active', trialEndsAt: inDays(-30) }),
      NOW,
    );
    expect(access.canWrite).toBe(true);
  });

  it('keeps a past_due account working while Stripe retries the card', () => {
    const access = evaluateAccess(
      account({ subscriptionStatus: 'past_due', trialEndsAt: inDays(-30) }),
      NOW,
    );
    expect(access.canWrite).toBe(true);
    expect(access.status).toBe('past_due');
  });

  it('blocks writing after cancellation, and says so distinctly', () => {
    const access = evaluateAccess(
      account({ subscriptionStatus: 'canceled', trialEndsAt: inDays(-30) }),
      NOW,
    );
    expect(access.canWrite).toBe(false);
    expect(access.status).toBe('canceled');
  });

  it('blocks unknown or incomplete statuses rather than assuming the best', () => {
    for (const status of ['incomplete', 'incomplete_expired', 'unpaid', 'paused', 'weird']) {
      expect(evaluateAccess(account({ subscriptionStatus: status }), NOW).canWrite).toBe(false);
    }
  });

  it('honours the remaining trial for someone who cancelled during it', () => {
    // Signed up, subscribed on day two, changed their mind on day three. The
    // trial was given unconditionally, so the rest of it is still theirs —
    // cancelling early should not be punished by ending access early.
    const access = evaluateAccess(
      account({ subscriptionStatus: 'canceled', trialEndsAt: inDays(3) }),
      NOW,
    );
    expect(access.canWrite).toBe(true);
    expect(access.status).toBe('trialing');
  });

  it('blocks once both the subscription and the trial are gone', () => {
    const access = evaluateAccess(
      account({ subscriptionStatus: 'canceled', trialEndsAt: inDays(-1) }),
      NOW,
    );
    expect(access.canWrite).toBe(false);
    expect(access.status).toBe('canceled');
  });
});

describe('trialEndsFromNow', () => {
  it('lands in the future', () => {
    expect(trialEndsFromNow(NOW).getTime()).toBeGreaterThan(NOW.getTime());
  });
});
