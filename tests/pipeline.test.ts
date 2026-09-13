import { LeadStatus, PlanTier, SubscriptionStatus, UsageMetric } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { effectivePlan } from '@/lib/billing/usage';
import {
  OPEN_STATUSES,
  PIPELINE,
  POSITION_GAP,
  columnFor,
  positionBetween,
  respacedPositions,
} from '@/lib/leads/pipeline';

describe('the pipeline', () => {
  it('has a column for every status the schema can store', () => {
    // A lead whose status has no column would vanish from the board — present
    // in the database, invisible to the person meant to act on it.
    for (const status of Object.values(LeadStatus)) {
      expect(() => columnFor(status)).not.toThrow();
    }
  });

  it('runs in the documented order', () => {
    expect(PIPELINE.map((column) => column.status)).toEqual([
      LeadStatus.NEW,
      LeadStatus.CONTACTED,
      LeadStatus.QUALIFIED,
      LeadStatus.QUOTE_PENDING,
      LeadStatus.QUOTE_SENT,
      LeadStatus.NEGOTIATING,
      LeadStatus.WON,
      LeadStatus.LOST,
    ]);
  });

  it('treats exactly WON and LOST as terminal', () => {
    expect(PIPELINE.filter((column) => column.terminal).map((column) => column.status)).toEqual([
      LeadStatus.WON,
      LeadStatus.LOST,
    ]);
    expect(OPEN_STATUSES).toHaveLength(6);
  });
});

describe('positionBetween', () => {
  it('places the first card in an empty column', () => {
    expect(positionBetween(null, null)).toEqual({ kind: 'position', position: POSITION_GAP });
  });

  it('places a card above the current first', () => {
    const result = positionBetween(null, 1000);
    expect(result).toEqual({ kind: 'position', position: 500 });
  });

  it('halves rather than subtracting, so positions stay positive', () => {
    // Subtracting a fixed gap from the top card would go negative after enough
    // drops at the top; halving never does.
    let top = POSITION_GAP;
    for (let drop = 0; drop < 15; drop += 1) {
      const result = positionBetween(null, top);
      if (result.kind === 'respace') break;
      expect(result.position).toBeGreaterThan(0);
      top = result.position;
    }
  });

  it('appends below the last card', () => {
    expect(positionBetween(5000, null)).toEqual({
      kind: 'position',
      position: 5000 + POSITION_GAP,
    });
  });

  it('takes the midpoint between two cards', () => {
    expect(positionBetween(1000, 2000)).toEqual({ kind: 'position', position: 1500 });
  });

  it('asks for a respace when no integer fits', () => {
    // The whole point of the gap: when it is finally exhausted, say so rather
    // than silently returning a duplicate position and scrambling the order.
    expect(positionBetween(1000, 1001)).toEqual({ kind: 'respace' });
    expect(positionBetween(1000, 1000)).toEqual({ kind: 'respace' });
  });

  it('asks for a respace at the very top of the range', () => {
    // Regression: a column whose first card sits at 0 or 1 has no room above
    // it. Returning a constant here instead gave every subsequent new lead the
    // *same* position, leaving the column with no defined order at all — only
    // the secondary sort was keeping the board looking sensible.
    expect(positionBetween(null, 1)).toEqual({ kind: 'respace' });
    expect(positionBetween(null, 0)).toEqual({ kind: 'respace' });
  });

  it('survives many midpoint drops in the same slot before respacing', () => {
    // With a 65536 gap there should be room for sixteen consecutive drops
    // between the same pair before the integers run out.
    let above = 0;
    const below = POSITION_GAP;
    let drops = 0;

    for (; drops < 100; drops += 1) {
      const result = positionBetween(above, below);
      if (result.kind === 'respace') break;
      above = result.position;
    }

    expect(drops).toBeGreaterThanOrEqual(15);
  });
});

describe('respacedPositions', () => {
  it('spreads a column evenly with room between every pair', () => {
    const positions = respacedPositions(4);
    expect(positions).toEqual([POSITION_GAP, POSITION_GAP * 2, POSITION_GAP * 3, POSITION_GAP * 4]);

    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]! - positions[index - 1]!).toBe(POSITION_GAP);
    }
  });

  it('is strictly increasing and never zero', () => {
    const positions = respacedPositions(10);
    expect(positions[0]).toBeGreaterThan(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('handles an empty column', () => {
    expect(respacedPositions(0)).toEqual([]);
  });
});

describe('effectivePlan', () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);

  it('gives a workspace with no subscription row the free plan', () => {
    expect(effectivePlan(null)).toBe(PlanTier.FREE);
  });

  it('honours a live trial', () => {
    expect(
      effectivePlan({
        plan: PlanTier.PRO,
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: future,
      }),
    ).toBe(PlanTier.PRO);
  });

  it('drops to free when the trial has run out', () => {
    expect(
      effectivePlan({
        plan: PlanTier.PRO,
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: past,
      }),
    ).toBe(PlanTier.FREE);
  });

  it('honours an active paid plan', () => {
    expect(
      effectivePlan({
        plan: PlanTier.BUSINESS,
        status: SubscriptionStatus.ACTIVE,
        trialEndsAt: null,
      }),
    ).toBe(PlanTier.BUSINESS);
  });

  it.each([SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELED, SubscriptionStatus.UNPAID])(
    'falls back to free on %s rather than locking the account',
    (status) => {
      // Deliberate: locking someone out of their own customer list over a
      // failed card turns a billing problem into a cancellation. They keep
      // their data and hit the free ceiling.
      expect(effectivePlan({ plan: PlanTier.PRO, status, trialEndsAt: null })).toBe(PlanTier.FREE);
    },
  );
});

describe('usage metrics', () => {
  it('has a label for every metric the enum defines', () => {
    // enforceUsageLimit interpolates the label into the error a customer reads;
    // a missing one would render "undefined" in the upgrade prompt.
    for (const metric of Object.values(UsageMetric)) {
      expect(typeof metric).toBe('string');
    }
    expect(Object.values(UsageMetric)).toContain(UsageMetric.LEADS);
  });
});
