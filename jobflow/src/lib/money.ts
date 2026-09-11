/**
 * Money is handled exclusively in integer minor units (cents).
 *
 * Floating-point currency is the classic source of "your total is off by a
 * penny" bugs, and a quote whose line items do not add up to its total is a
 * document a business cannot send. Conversion to a float happens only at the
 * display boundary.
 *
 * Percentages are basis points (1 bps = 0.01%), for the same reason: a 30%
 * margin is 3000, not 0.3, and no rounding happens until the final cent.
 */

/** $1,000,000 — a sane ceiling for a single residential service quote. */
export const MAX_AMOUNT_CENTS = 100_000_000;

/** 100% in basis points. */
export const BPS_SCALE = 10_000;

/**
 * Parses user input into cents: "1,234.56", "$45.00", "45", "12,50".
 *
 * The hard part is that the same characters mean different things in different
 * places — "1.000,50" is a thousand euros and fifty cents, while "1,000.50" is
 * a thousand dollars and fifty cents. The rule used here is:
 *
 *   - Whichever of `.` or `,` appears *last* is the decimal mark, provided it
 *     is followed by one or two digits.
 *   - A separator followed by exactly three digits is a thousands separator,
 *     but only when the whole string is validly grouped ("1,234", "1,234,567").
 *     A single dot before three digits ("12.345") is rejected as ambiguous: far
 *     more often a mistyped decimal than European grouping, and silently
 *     reading it as $123.45 would be a 10x error in someone's pricing.
 */
const GROUPED = /^\d{1,3}(?:[.,]\d{3})*$/;

export function parseAmountToCents(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }

  // Strip whitespace (including the non-breaking and narrow spaces some
  // locales use for grouping) and currency symbols.
  const cleaned = input.replace(/[\s  ]/g, '').replace(/[$£€]/g, '');
  if (cleaned.length === 0) return null;

  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  if (!/^[\d.,]+$/.test(body)) return null;

  const lastSeparator = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));

  let whole: string;
  let fraction = '0';

  if (lastSeparator === -1) {
    whole = body;
  } else {
    const head = body.slice(0, lastSeparator);
    const tail = body.slice(lastSeparator + 1);
    const separator = body[lastSeparator]!;

    if (/^\d{1,2}$/.test(tail)) {
      if (!GROUPED.test(head)) return null;
      whole = head.replace(/[.,]/g, '');
      fraction = tail.padEnd(2, '0');
    } else if (/^\d{3}$/.test(tail) && GROUPED.test(body)) {
      // Grouping is only trusted for commas, or when there is more than one
      // separator (which no decimal notation produces).
      const separatorCount = (body.match(/[.,]/g) ?? []).length;
      if (separator !== ',' && separatorCount === 1) return null;
      whole = body.replace(/[.,]/g, '');
    } else {
      return null;
    }
  }

  if (!/^\d+$/.test(whole)) return null;

  const cents = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents)) return null;

  return negative ? -cents : cents;
}

export function formatCents(cents: number, currency = 'USD', locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // Unknown currency code (hand-edited data) — degrade rather than crash.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Whole dollars, for dashboard tiles where cents are noise. */
export function formatCentsCompact(cents: number, currency = 'USD', locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${Math.round(cents / 100)} ${currency}`;
  }
}

/** Plain decimal string for CSV cells, where a currency symbol would be noise. */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** "30%" from 3000. One decimal place only when the value needs it. */
export function formatBps(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/** Applies a basis-point rate to an amount, rounding half away from zero. */
export function applyBps(amountCents: number, bps: number): number {
  return roundHalfAwayFromZero((amountCents * bps) / BPS_SCALE);
}

/**
 * `Math.round` rounds -0.5 to -0, which makes a discount and its reversal
 * disagree by a cent. Rounding on the magnitude keeps the operation symmetric.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Marks a cost up to hit a target *margin* — not a markup.
 *
 * The distinction is the single most common pricing mistake in the trades, and
 * it costs real money. Adding 30% to a $100 cost gives $130, on which the
 * profit is $30 of $130 — a 23% margin, not 30%. To actually keep 30% of the
 * sale price the divisor is (1 - margin): 100 / 0.70 = $142.86.
 *
 * A business that quotes the first number and budgets for the second loses the
 * difference on every job, so this function does the division.
 */
export function priceForMargin(costCents: number, marginBps: number): number {
  // A 100% margin implies infinite price; anything beyond is nonsense. Clamp
  // rather than divide by zero and hand someone an Infinity in a quote.
  const clamped = Math.min(Math.max(marginBps, 0), BPS_SCALE - 1);
  return roundHalfAwayFromZero((costCents * BPS_SCALE) / (BPS_SCALE - clamped));
}

/** The margin actually achieved by a price, in basis points. */
export function marginBpsFor(priceCents: number, costCents: number): number {
  if (priceCents <= 0) return 0;
  return roundHalfAwayFromZero(((priceCents - costCents) * BPS_SCALE) / priceCents);
}

/**
 * Splits `totalCents` into parts proportional to `weights`, summing to exactly
 * `totalCents`.
 *
 * Naive proportional division loses money: three equal shares of $10.00 give
 * 333 + 333 + 333 = $9.99, and a quote whose lines do not add up to its total
 * is worse than no breakdown at all. This uses the largest-remainder method —
 * everyone gets their floor, then the leftover cents go one each to whoever was
 * rounded down hardest — which is the standard apportionment rule and the same
 * one accountants use to spread tax across line items.
 *
 * Returns integer cents in the same order as `weights`.
 */
export function apportionCents(totalCents: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  if (!Number.isInteger(totalCents)) {
    throw new Error('apportionCents requires an integer amount in cents.');
  }

  const safeWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);

  // No usable weights (all zero): divide evenly so the total is still preserved
  // rather than silently dropped.
  if (weightSum <= 0) {
    const base = Math.floor(totalCents / weights.length);
    const parts = new Array<number>(weights.length).fill(base);
    let leftover = totalCents - base * weights.length;
    for (let index = 0; leftover > 0; index += 1, leftover -= 1) {
      parts[index % parts.length] = (parts[index % parts.length] ?? 0) + 1;
    }
    return parts;
  }

  const exact = safeWeights.map((weight) => (totalCents * weight) / weightSum);
  const parts = exact.map((value) => Math.floor(value));
  const distributed = parts.reduce((sum, part) => sum + part, 0);

  // Hand out the remaining cents to the largest fractional remainders first.
  // Ties break by index so the result is deterministic and testable.
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  let remaining = totalCents - distributed;
  for (let step = 0; remaining > 0 && step < order.length; step += 1) {
    const target = order[step]!.index;
    parts[target] = (parts[target] ?? 0) + 1;
    remaining -= 1;
  }

  return parts;
}
