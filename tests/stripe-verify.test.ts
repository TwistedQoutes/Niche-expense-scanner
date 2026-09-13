import { PlanTier, SubscriptionStatus } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { effectivePlan } from '@/lib/billing/usage';
import { mapStripeStatus } from '@/lib/stripe/subscriptions';

import {
  DEFAULT_TOLERANCE_SECONDS,
  computeSignature,
  parseSignatureHeader,
  signaturesMatch,
  verifyStripeSignature,
} from '@/lib/stripe/verify';

/**
 * A forged webhook is a free Business plan for anyone who can post to the
 * endpoint, and a forged cancellation downgrades a paying customer. This file
 * gets more attention than any other in the phase.
 */

const SECRET = 'whsec_testsecretvalue';
const RAW_BODY = '{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"id":"cs_1"}}}';

/** The header Stripe would send for this body at this moment. */
function header(timestamp: number, body = RAW_BODY, secret = SECRET): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

const NOW = new Date('2026-09-13T12:00:00Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

describe('the signed payload', () => {
  it('is the timestamp, a dot, and the raw body', () => {
    // Stripe's documented scheme. Getting the separator or the order wrong makes
    // every real webhook fail, and the usual "fix" for that is to stop verifying.
    const expected = createHmac('sha256', SECRET)
      .update(`${NOW_SECONDS}.${RAW_BODY}`, 'utf8')
      .digest('hex');

    expect(computeSignature(SECRET, NOW_SECONDS, RAW_BODY)).toBe(expected);
  });

  it('is sensitive to the exact bytes of the body', () => {
    // Why the raw body must be used rather than a re-serialised object: any
    // change in whitespace or key order is a different signature.
    const reserialised = JSON.stringify(JSON.parse(RAW_BODY), null, 2);

    expect(computeSignature(SECRET, NOW_SECONDS, reserialised)).not.toBe(
      computeSignature(SECRET, NOW_SECONDS, RAW_BODY),
    );
  });
});

describe('parsing the Stripe-Signature header', () => {
  it('reads the timestamp and the signature', () => {
    const parsed = parseSignatureHeader(`t=${NOW_SECONDS},v1=abc123`);

    expect(parsed).toEqual({ timestamp: NOW_SECONDS, signatures: ['abc123'] });
  });

  it('keeps every v1, not just the first', () => {
    // Stripe sends more than one during a secret rotation. Reading only the first
    // breaks every webhook for the length of the rollover.
    const parsed = parseSignatureHeader(`t=${NOW_SECONDS},v1=first,v1=second`);

    expect(parsed?.signatures).toEqual(['first', 'second']);
  });

  it('ignores schemes it does not understand', () => {
    // v0 appears on Stripe's test events and is not the one to verify.
    const parsed = parseSignatureHeader(`t=${NOW_SECONDS},v0=ignored,v1=real`);

    expect(parsed?.signatures).toEqual(['real']);
  });

  it('tolerates the whitespace Stripe puts after the commas', () => {
    const parsed = parseSignatureHeader(`t=${NOW_SECONDS}, v1=abc`);

    expect(parsed).toEqual({ timestamp: NOW_SECONDS, signatures: ['abc'] });
  });

  it('refuses a header with no usable timestamp', () => {
    // A NaN timestamp would make every tolerance comparison false, which is the
    // kind of bug that passes or fails for the wrong reason.
    expect(parseSignatureHeader('t=notanumber,v1=abc')).toBeNull();
    expect(parseSignatureHeader('t=,v1=abc')).toBeNull();
    expect(parseSignatureHeader('v1=abc')).toBeNull();
  });

  it('refuses a header with no signature', () => {
    expect(parseSignatureHeader(`t=${NOW_SECONDS}`)).toBeNull();
    expect(parseSignatureHeader(`t=${NOW_SECONDS},v0=only`)).toBeNull();
    expect(parseSignatureHeader('')).toBeNull();
  });
});

describe('verifying a webhook', () => {
  it('accepts a correctly signed, current request', () => {
    expect(
      verifyStripeSignature({
        secret: SECRET,
        rawBody: RAW_BODY,
        signatureHeader: header(NOW_SECONDS),
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts one signed with either secret during a rotation', () => {
    const rotating = `t=${NOW_SECONDS},v1=${createHmac('sha256', 'whsec_old')
      .update(`${NOW_SECONDS}.${RAW_BODY}`, 'utf8')
      .digest('hex')},v1=${createHmac('sha256', SECRET)
      .update(`${NOW_SECONDS}.${RAW_BODY}`, 'utf8')
      .digest('hex')}`;

    expect(
      verifyStripeSignature({
        secret: SECRET,
        rawBody: RAW_BODY,
        signatureHeader: rotating,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a body that has been tampered with', () => {
    // The whole point: someone rewriting the event to grant themselves a plan.
    const forged = RAW_BODY.replace('cs_1', 'cs_forged');

    expect(
      verifyStripeSignature({
        secret: SECRET,
        rawBody: forged,
        signatureHeader: header(NOW_SECONDS),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a signature made with a different secret', () => {
    expect(
      verifyStripeSignature({
        secret: SECRET,
        rawBody: RAW_BODY,
        signatureHeader: header(NOW_SECONDS, RAW_BODY, 'whsec_wrong'),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects a replayed request', () => {
    // Without the timestamp check a captured signature stays valid forever, and
    // replaying a payment event as often as you like is free credit.
    const old = NOW_SECONDS - DEFAULT_TOLERANCE_SECONDS - 1;

    expect(
      verifyStripeSignature({
        secret: SECRET,
        rawBody: RAW_BODY,
        signatureHeader: header(old),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'too_old' });
  });

  it('accepts one that is old but inside the tolerance', () => {
    const recent = NOW_SECONDS - DEFAULT_TOLERANCE_SECONDS + 5;

    expect(
      verifyStripeSignature({
        secret: SECRET,
        rawBody: RAW_BODY,
        signatureHeader: header(recent),
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects one from implausibly far in the future', () => {
    // Accepting future timestamps would let a captured signature stay usable
    // indefinitely.
    const ahead = NOW_SECONDS + DEFAULT_TOLERANCE_SECONDS + 1;

    expect(
      verifyStripeSignature({
        secret: SECRET,
        rawBody: RAW_BODY,
        signatureHeader: header(ahead),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'too_old' });
  });

  it('rejects a request with no signature header', () => {
    expect(
      verifyStripeSignature({ secret: SECRET, rawBody: RAW_BODY, signatureHeader: null, now: NOW }),
    ).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('rejects a malformed header without pretending it was a mismatch', () => {
    expect(
      verifyStripeSignature({
        secret: SECRET,
        rawBody: RAW_BODY,
        signatureHeader: 'garbage',
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  it('fails closed when no signing secret is configured', () => {
    // The alternative — accepting when unconfigured — turns a missing environment
    // variable into a way to grant yourself a paid plan.
    expect(
      verifyStripeSignature({
        secret: undefined,
        rawBody: RAW_BODY,
        signatureHeader: header(NOW_SECONDS),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('rejects a re-serialised body even when nothing meaningful changed', () => {
    // Documents why the route must read request.text() and not request.json().
    const reserialised = JSON.stringify(JSON.parse(RAW_BODY));
    const spaced = JSON.stringify(JSON.parse(RAW_BODY), null, 2);

    expect(
      verifyStripeSignature({
        secret: SECRET,
        rawBody: spaced,
        signatureHeader: header(NOW_SECONDS, reserialised),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('compares without throwing on a length mismatch', () => {
    expect(signaturesMatch('abc', 'abcdef')).toBe(false);
    expect(signaturesMatch('', '')).toBe(true);
    expect(signaturesMatch('abc', 'abc')).toBe(true);
  });
});

describe('mapping Stripe subscription statuses', () => {
  it('maps the ordinary lifecycle', () => {
    expect(mapStripeStatus('trialing')).toBe(SubscriptionStatus.TRIALING);
    expect(mapStripeStatus('active')).toBe(SubscriptionStatus.ACTIVE);
    expect(mapStripeStatus('past_due')).toBe(SubscriptionStatus.PAST_DUE);
    expect(mapStripeStatus('canceled')).toBe(SubscriptionStatus.CANCELED);
  });

  it('keeps unpaid distinct from past due', () => {
    // Stripe has stopped retrying the card, which is further along than "a
    // payment bounced" and needs the customer to act.
    expect(mapStripeStatus('unpaid')).toBe(SubscriptionStatus.UNPAID);
  });

  it('treats a first payment that never completed as not yet paid', () => {
    // `incomplete` means nothing has been bought yet, so it must not read as
    // active — but it should not lock anybody out either.
    expect(mapStripeStatus('incomplete')).toBe(SubscriptionStatus.PAST_DUE);
    expect(mapStripeStatus('incomplete_expired')).toBe(SubscriptionStatus.CANCELED);
  });

  it('assumes the worst about a status it does not recognise', () => {
    // A status Stripe adds later must not accidentally grant a paid plan.
    for (const unknown of ['', 'something_new', 'ACTIVE', 'paid']) {
      expect(mapStripeStatus(unknown)).toBe(SubscriptionStatus.PAST_DUE);
    }
  });

  it('never maps an unrecognised status to one that grants access', () => {
    const granting = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING];

    for (const unknown of ['whatever', 'trial', 'live']) {
      expect(granting).not.toContain(mapStripeStatus(unknown));
    }
  });
});

describe('which plan an effective tier grants after a billing failure', () => {
  it('falls back to free without deleting anything', () => {
    // The product decision: a failed card must not lock somebody out of their own
    // customer list, because that turns a billing problem into a cancellation.
    const base = { plan: PlanTier.PRO, trialEndsAt: null };

    expect(effectivePlan({ ...base, status: SubscriptionStatus.ACTIVE })).toBe(PlanTier.PRO);
    expect(effectivePlan({ ...base, status: SubscriptionStatus.PAST_DUE })).toBe(PlanTier.FREE);
    expect(effectivePlan({ ...base, status: SubscriptionStatus.UNPAID })).toBe(PlanTier.FREE);
    expect(effectivePlan({ ...base, status: SubscriptionStatus.CANCELED })).toBe(PlanTier.FREE);
    expect(effectivePlan({ ...base, status: SubscriptionStatus.INCOMPLETE })).toBe(PlanTier.FREE);
  });

  it('honours a trial until it runs out, then stops', () => {
    const now = new Date('2026-09-13T12:00:00Z');

    expect(
      effectivePlan(
        {
          plan: PlanTier.PRO,
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: new Date('2026-09-20T12:00:00Z'),
        },
        now,
      ),
    ).toBe(PlanTier.PRO);

    expect(
      effectivePlan(
        {
          plan: PlanTier.PRO,
          status: SubscriptionStatus.TRIALING,
          trialEndsAt: new Date('2026-09-01T12:00:00Z'),
        },
        now,
      ),
    ).toBe(PlanTier.FREE);
  });

  it('gives a workspace with no subscription row the free plan', () => {
    expect(effectivePlan(null)).toBe(PlanTier.FREE);
  });
});
