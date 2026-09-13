import { describe, expect, it } from 'vitest';

import { INDUSTRIES } from '@/lib/services/templates';
import {
  ONBOARDING_STEPS,
  businessStepSchema,
  isOnboardingStep,
  onboardingBodySchema,
  pricingStepSchema,
  reviewStepSchema,
  tradeStepSchema,
} from '@/lib/validation/onboarding';

/**
 * A setup wizard's job is to be finishable. These pin the two ways that goes
 * wrong: a step that accepts nothing and calls itself answered, and a step that
 * refuses something reasonable and traps the person on it.
 */

describe('the steps', () => {
  it('are short enough to finish between jobs', () => {
    // Every extra step is a chance for somebody who signed up at 7am to close the
    // tab. Four is the budget.
    expect(ONBOARDING_STEPS.length).toBeLessThanOrEqual(4);
  });

  it('each say what they are for', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
      expect(step.blurb.length).toBeGreaterThan(0);
    }
  });

  it('recognises its own step keys and nothing else', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(isOnboardingStep(step.key)).toBe(true);
    }
    expect(isOnboardingStep('nonsense')).toBe(false);
    expect(isOnboardingStep(undefined)).toBe(false);
  });
});

describe('the trade step', () => {
  it('accepts every trade the product offers', () => {
    for (const industry of INDUSTRIES) {
      expect(tradeStepSchema.safeParse({ industry: industry.key }).success).toBe(true);
    }
  });

  it('refuses a trade that is not on the list', () => {
    // The industry decides which starter catalogue gets installed, so an unknown
    // value would install nothing and look like the step did not work.
    expect(tradeStepSchema.safeParse({ industry: 'underwater_basket_weaving' }).success).toBe(false);
    expect(tradeStepSchema.safeParse({ industry: '' }).success).toBe(false);
    expect(tradeStepSchema.safeParse({}).success).toBe(false);
  });
});

describe('the business step', () => {
  const valid = { phone: '+15125550101', timezone: 'America/Chicago' };

  it('takes a phone and a timezone', () => {
    expect(businessStepSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a timezone the runtime does not know', () => {
    // A bad zone throws inside Intl on every calendar render, taking the page down
    // rather than showing the wrong hour.
    expect(businessStepSchema.safeParse({ ...valid, timezone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('refuses a phone number too short to reach anybody', () => {
    expect(businessStepSchema.safeParse({ ...valid, phone: '123' }).success).toBe(false);
    expect(businessStepSchema.safeParse({ ...valid, phone: '' }).success).toBe(false);
  });

  it('does not insist on a town and state', () => {
    // They are useful, not required. A wizard that will not let you past a field
    // you do not have to hand is how a product loses the customer it just won.
    expect(businessStepSchema.safeParse(valid).success).toBe(true);
  });
});

describe('the pricing step', () => {
  const valid = {
    defaultLaborRateCents: 6_500,
    defaultProfitMarginBps: 3_000,
    defaultMinimumJobCents: 5_000,
  };

  it('takes whole cents and basis points', () => {
    expect(pricingStepSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a margin of 100% or more, which would divide by zero', () => {
    // `priceForMargin` divides by (1 - margin). 99% is extreme but arithmetically
    // fine; 100% is not a price, it is an error.
    expect(pricingStepSchema.safeParse({ ...valid, defaultProfitMarginBps: 10_000 }).success).toBe(
      false,
    );
    expect(pricingStepSchema.safeParse({ ...valid, defaultProfitMarginBps: 9_900 }).success).toBe(
      true,
    );
  });

  it('refuses a negative margin', () => {
    expect(pricingStepSchema.safeParse({ ...valid, defaultProfitMarginBps: -100 }).success).toBe(
      false,
    );
  });

  it('refuses fractional cents', () => {
    expect(pricingStepSchema.safeParse({ ...valid, defaultLaborRateCents: 6_500.5 }).success).toBe(
      false,
    );
  });

  it('allows a zero minimum, for somebody who has no floor', () => {
    expect(pricingStepSchema.safeParse({ ...valid, defaultMinimumJobCents: 0 }).success).toBe(true);
  });
});

describe('the review step', () => {
  it('accepts a real review link', () => {
    expect(reviewStepSchema.safeParse({ reviewUrl: 'https://g.page/r/abc/review' }).success).toBe(
      true,
    );
  });

  it('accepts no link at all, because most people do not have one to hand', () => {
    const parsed = reviewStepSchema.safeParse({ reviewUrl: '' });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.reviewUrl).toBeNull();
  });

  it('still refuses a dangerous one', () => {
    // The wizard is not a way round the validation Settings does.
    expect(reviewStepSchema.safeParse({ reviewUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(
      reviewStepSchema.safeParse({ reviewUrl: 'https://www.google.com@evil.example' }).success,
    ).toBe(false);
  });
});

describe('the request body', () => {
  it('will not let an empty body count as a completed step', () => {
    // The failure this guards: a step that accepts nothing, saves nothing, and
    // moves on — so the wizard skips the question it most needed answering.
    expect(onboardingBodySchema.safeParse({ step: 'trade' }).success).toBe(false);
    expect(onboardingBodySchema.safeParse({ step: 'business' }).success).toBe(false);
    expect(onboardingBodySchema.safeParse({ step: 'pricing' }).success).toBe(false);
    expect(onboardingBodySchema.safeParse({}).success).toBe(false);
  });

  it('lets the finish step carry nothing, because it saves nothing', () => {
    expect(onboardingBodySchema.safeParse({ step: 'finish' }).success).toBe(true);
  });

  it('refuses a step name it does not know', () => {
    expect(onboardingBodySchema.safeParse({ step: 'admin', industry: 'lawn_care' }).success).toBe(
      false,
    );
  });
});
