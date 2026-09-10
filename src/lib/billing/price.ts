import { getEnv } from '@/lib/env';

/**
 * The price shown on the subscribe button.
 *
 * Read from configuration rather than fetched from Stripe: the button renders
 * on the server on every settings visit, and a network round-trip to display a
 * number that changes once a year is not a good trade. Stripe remains the
 * authority on what is actually charged — this is a label.
 *
 * Keep `PRICE_LABEL` in step with the Stripe price whenever it changes.
 */
export function describePrice(): string {
  return getEnv().PRICE_LABEL;
}
