import { z } from 'zod';

import { isIndustryKey } from '@/lib/services/templates';
import { bpsSchema, centsSchema, singleLineText } from '@/lib/validation/common';
import { reviewUrlSchema, timeZoneSchema } from '@/lib/validation/settings';

/**
 * The onboarding wizard's steps.
 *
 * One schema per step rather than one big partial, because each step is a
 * separate request and a partial schema would let an empty body count as a
 * completed step — which is how a wizard silently skips the question it most
 * needed answering.
 */

export const tradeStepSchema = z.object({
  industry: z.string().refine(isIndustryKey, 'Choose the trade that fits best.'),
});

export const businessStepSchema = z.object({
  phone: singleLineText(30).pipe(z.string().min(7, 'A phone number this short will not reach you.')),
  timezone: timeZoneSchema,
  city: singleLineText(80).optional(),
  state: singleLineText(40).optional(),
});

export const pricingStepSchema = z.object({
  defaultLaborRateCents: centsSchema,
  defaultProfitMarginBps: bpsSchema,
  defaultMinimumJobCents: centsSchema,
});

export const reviewStepSchema = z.object({
  reviewUrl: reviewUrlSchema,
});

/** The wizard's steps, in order, with what each one is for. */
export const ONBOARDING_STEPS = [
  { key: 'trade', label: 'Your trade', blurb: 'So the services and prices start close to right.' },
  { key: 'business', label: 'Where you work', blurb: 'The timezone every booking is read in.' },
  { key: 'pricing', label: 'What you charge', blurb: 'The defaults every quote starts from.' },
  { key: 'reviews', label: 'Getting found', blurb: 'Where a happy customer leaves a review.' },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]['key'];

export function isOnboardingStep(value: string | undefined): value is OnboardingStepKey {
  return value !== undefined && ONBOARDING_STEPS.some((step) => step.key === value);
}

export const onboardingBodySchema = z.discriminatedUnion('step', [
  tradeStepSchema.extend({ step: z.literal('trade') }),
  businessStepSchema.extend({ step: z.literal('business') }),
  pricingStepSchema.extend({ step: z.literal('pricing') }),
  reviewStepSchema.extend({ step: z.literal('reviews') }),
  /** The last one. Nothing to save — it stamps the workspace as onboarded. */
  z.object({ step: z.literal('finish') }),
]);
