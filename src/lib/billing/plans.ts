import { PlanTier, UsageMetric } from '@prisma/client';

/**
 * The plans, defined once.
 *
 * The pricing page, the billing screen and the usage guard all read this table.
 * That is the point: a limit shown on the marketing site and a limit enforced
 * in the API that come from two different places will eventually disagree, and
 * the version the customer remembers is the one on the marketing site.
 */

/** `null` means unlimited. */
export type PlanLimits = Record<UsageMetric, number | null>;

export type Plan = {
  tier: PlanTier;
  name: string;
  tagline: string;
  monthlyPriceCents: number;
  /** Which env var holds the Stripe price id for this tier. */
  stripePriceEnvKey: string | null;
  highlighted: boolean;
  features: string[];
  limits: PlanLimits;
};

export const PLANS: Plan[] = [
  {
    tier: PlanTier.FREE,
    name: 'Free',
    tagline: 'Enough to run a handful of jobs and see whether this fits.',
    monthlyPriceCents: 0,
    stripePriceEnvKey: null,
    highlighted: false,
    features: ['5 leads a month', '5 quotes a month', 'Customer records', 'Professional quote pages'],
    limits: {
      [UsageMetric.LEADS]: 5,
      [UsageMetric.QUOTES]: 5,
      // Zero, not null: the free plan cannot send SMS at all. Every message
      // costs us money at the carrier, and an unmetered free tier is a bill
      // someone else writes for you.
      [UsageMetric.SMS_SENT]: 0,
      [UsageMetric.EMAILS_SENT]: 50,
      [UsageMetric.AI_CALLS]: 0,
    },
  },
  {
    tier: PlanTier.STARTER,
    name: 'Starter',
    tagline: 'For a one-truck operation that is tired of chasing quotes by hand.',
    monthlyPriceCents: 4900,
    stripePriceEnvKey: 'STRIPE_PRICE_STARTER',
    highlighted: false,
    features: [
      '50 leads a month',
      '50 quotes a month',
      'Automated follow-up',
      'AI lead qualification',
      'Email sequences',
    ],
    limits: {
      [UsageMetric.LEADS]: 50,
      [UsageMetric.QUOTES]: 50,
      [UsageMetric.SMS_SENT]: 250,
      [UsageMetric.EMAILS_SENT]: 1_000,
      [UsageMetric.AI_CALLS]: 200,
    },
  },
  {
    tier: PlanTier.PRO,
    name: 'Pro',
    tagline: 'The whole system, for a business that lives or dies on response time.',
    monthlyPriceCents: 9900,
    stripePriceEnvKey: 'STRIPE_PRICE_PRO',
    highlighted: true,
    features: [
      '200 leads a month',
      '200 quotes a month',
      'AI customer assistant',
      'SMS and missed-call text back',
      'Automations',
      'Full analytics',
    ],
    limits: {
      [UsageMetric.LEADS]: 200,
      [UsageMetric.QUOTES]: 200,
      [UsageMetric.SMS_SENT]: 1_500,
      [UsageMetric.EMAILS_SENT]: 5_000,
      [UsageMetric.AI_CALLS]: 1_500,
    },
  },
  {
    tier: PlanTier.BUSINESS,
    name: 'Business',
    tagline: 'Crews, territories and the reporting to keep them straight.',
    monthlyPriceCents: 19900,
    stripePriceEnvKey: 'STRIPE_PRICE_BUSINESS',
    highlighted: false,
    features: [
      'Unlimited leads and quotes',
      'Multiple employees',
      'Advanced automations',
      'Advanced analytics',
      'Priority support',
    ],
    limits: {
      [UsageMetric.LEADS]: null,
      [UsageMetric.QUOTES]: null,
      [UsageMetric.SMS_SENT]: 10_000,
      [UsageMetric.EMAILS_SENT]: 50_000,
      [UsageMetric.AI_CALLS]: 10_000,
    },
  },
];

const BY_TIER = new Map(PLANS.map((plan) => [plan.tier, plan]));

export function planFor(tier: PlanTier): Plan {
  const plan = BY_TIER.get(tier);
  if (!plan) {
    // Unreachable while PlanTier and PLANS stay in step, and a loud failure is
    // better than silently granting whatever the first plan happens to allow.
    throw new Error(`No plan definition for tier "${tier}".`);
  }
  return plan;
}

export function limitFor(tier: PlanTier, metric: UsageMetric): number | null {
  return planFor(tier).limits[metric];
}

/** How many employees a plan may have. Seats are a plan feature, not a meter. */
export function seatLimitFor(tier: PlanTier): number | null {
  switch (tier) {
    case PlanTier.FREE:
      return 1;
    case PlanTier.STARTER:
      return 2;
    case PlanTier.PRO:
      return 5;
    case PlanTier.BUSINESS:
      return null;
    default:
      return 1;
  }
}
