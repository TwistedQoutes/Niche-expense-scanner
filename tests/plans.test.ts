import { PlanTier, UsageMetric } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { PLANS, limitFor, planFor, seatLimitFor } from '@/lib/billing/plans';
import { slugify } from '@/lib/organizations/provision';
import { INDUSTRIES, SERVICE_TEMPLATES, templatesForIndustry } from '@/lib/services/templates';

describe('plans', () => {
  it('defines every tier in the schema enum', () => {
    // A tier the schema can store but the table does not describe would throw
    // on the first page render for whoever is on it.
    for (const tier of Object.values(PlanTier)) {
      expect(() => planFor(tier)).not.toThrow();
    }
  });

  it('prices the documented ladder', () => {
    expect(planFor(PlanTier.FREE).monthlyPriceCents).toBe(0);
    expect(planFor(PlanTier.STARTER).monthlyPriceCents).toBe(4900);
    expect(planFor(PlanTier.PRO).monthlyPriceCents).toBe(9900);
    expect(planFor(PlanTier.BUSINESS).monthlyPriceCents).toBe(19900);
  });

  it('sets a limit for every metric on every plan', () => {
    // A missing entry reads as `undefined`, and an `undefined` limit compared
    // against a count silently allows everything.
    for (const plan of PLANS) {
      for (const metric of Object.values(UsageMetric)) {
        expect(plan.limits[metric]).toBeDefined();
      }
    }
  });

  it('never lowers a limit as the price rises', () => {
    const ladder = [PlanTier.FREE, PlanTier.STARTER, PlanTier.PRO, PlanTier.BUSINESS];

    for (const metric of Object.values(UsageMetric)) {
      for (let index = 1; index < ladder.length; index += 1) {
        const lower = limitFor(ladder[index - 1]!, metric);
        const higher = limitFor(ladder[index]!, metric);

        // null is unlimited, so it can only ever be an increase.
        if (higher === null) continue;
        expect(lower).not.toBeNull();
        expect(higher).toBeGreaterThanOrEqual(lower!);
      }
    }
  });

  it('gives the free plan no SMS and no AI', () => {
    // Zero rather than null: every message and every model call costs real
    // money, and an unmetered free tier is a bill someone else writes for you.
    expect(limitFor(PlanTier.FREE, UsageMetric.SMS_SENT)).toBe(0);
    expect(limitFor(PlanTier.FREE, UsageMetric.AI_CALLS)).toBe(0);
  });

  it('matches the documented lead and quote allowances', () => {
    expect(limitFor(PlanTier.FREE, UsageMetric.LEADS)).toBe(5);
    expect(limitFor(PlanTier.STARTER, UsageMetric.LEADS)).toBe(50);
    expect(limitFor(PlanTier.PRO, UsageMetric.LEADS)).toBe(200);
    expect(limitFor(PlanTier.BUSINESS, UsageMetric.LEADS)).toBeNull();
  });

  it('highlights exactly one plan', () => {
    expect(PLANS.filter((plan) => plan.highlighted)).toHaveLength(1);
  });

  it('gives only the top plan unlimited seats', () => {
    expect(seatLimitFor(PlanTier.FREE)).toBe(1);
    expect(seatLimitFor(PlanTier.BUSINESS)).toBeNull();
  });

  it('names a Stripe price variable for every paid plan', () => {
    for (const plan of PLANS) {
      if (plan.monthlyPriceCents === 0) {
        expect(plan.stripePriceEnvKey).toBeNull();
      } else {
        expect(plan.stripePriceEnvKey).toBeTruthy();
      }
    }
  });
});

describe('slugify', () => {
  it('makes a URL-safe handle', () => {
    expect(slugify('Green & Co Lawns')).toBe('green-co-lawns');
    expect(slugify('  Pete’s Pressure Washing  ')).toBe('pete-s-pressure-washing');
  });

  it('strips accents rather than dropping the letters', () => {
    expect(slugify('Küche Cleaning')).toBe('kuche-cleaning');
  });

  it('never returns an empty or trailing-dash slug', () => {
    // A name of nothing but punctuation would otherwise produce an empty slug,
    // and every empty slug collides with every other one.
    expect(slugify('!!!')).toMatch(/^workspace-[0-9a-f]{6}$/);
    expect(slugify('a')).toMatch(/^workspace-[0-9a-f]{6}$/);
    expect(slugify('x'.repeat(80))).not.toMatch(/-$/);
  });

  it('caps the length', () => {
    expect(slugify('Very Long Business Name '.repeat(10)).length).toBeLessThanOrEqual(40);
  });
});

describe('service templates', () => {
  it('gives every industry at least one service to quote with', () => {
    // A workspace with no services cannot produce a quote, which is the thing
    // the owner signed up to do.
    for (const industry of INDUSTRIES) {
      expect(templatesForIndustry(industry.key).length).toBeGreaterThan(0);
    }
  });

  it('falls back for a trade we have not listed', () => {
    expect(templatesForIndustry('underwater-basket-weaving').length).toBeGreaterThan(0);
  });

  it('keys every template by its own key', () => {
    for (const [key, template] of Object.entries(SERVICE_TEMPLATES)) {
      expect(template.key).toBe(key);
    }
  });

  it('never sets a minimum above the base price', () => {
    // The reverse would mean the advertised base price is a price no customer
    // can ever actually be charged.
    for (const template of Object.values(SERVICE_TEMPLATES)) {
      expect(template.minimumPriceCents).toBeLessThanOrEqual(
        Math.max(template.basePriceCents, template.minimumPriceCents),
      );
      if (template.basePriceCents > 0) {
        expect(template.minimumPriceCents).toBeLessThanOrEqual(template.basePriceCents);
      }
    }
  });

  it('gives area-priced templates a non-zero unit size', () => {
    // A zero unit size would divide by zero in the calculator.
    for (const template of Object.values(SERVICE_TEMPLATES)) {
      expect(template.unitSizeSqFt).toBeGreaterThan(0);
    }
  });

  it('starts lawn care with mowing, as documented', () => {
    const lawnCare = templatesForIndustry('lawn_care');
    expect(lawnCare[0]?.key).toBe('lawn_mowing');
    expect(lawnCare[0]?.basePriceCents).toBe(4500);
  });
});
