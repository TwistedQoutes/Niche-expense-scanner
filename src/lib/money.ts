/**
 * Money is handled exclusively in integer minor units (cents).
 *
 * Floating-point currency is the classic source of "your total is off by a
 * penny" bugs, and an expense tracker whose totals do not add up is worthless.
 * Conversion to a float happens only at the display boundary.
 */

export const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000 — a sane upper bound for a receipt

/**
 * Parses user or OCR input into cents: "1,234.56", "$45.00", "45", "12,50".
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
 *     reading it as $123.45 would be a 10x error in someone's books.
 */
const GROUPED = /^\d{1,3}(?:[.,]\d{3})*$/;

export function parseAmountToCents(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }

  // Strip whitespace (including the non-breaking and narrow spaces some
  // locales use for grouping) and currency symbols.
  const cleaned = input.replace(/[\s\u00a0\u202f]/g, '').replace(/[$£€]/g, '');
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

/** Plain decimal string for CSV cells, where a currency symbol would be noise. */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/**
 * Splits `totalCents` into parts proportional to `weights`, summing to exactly
 * `totalCents`.
 *
 * Naive proportional division loses money: three equal shares of $10.00 give
 * 333 + 333 + 333 = $9.99, and a receipt whose parts do not add up to its total
 * is worse than no split at all. This uses the largest-remainder method —
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

  // No usable weights (all zero, or a single zero-value item): divide evenly so
  // the total is still preserved rather than silently dropped.
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

/** True when the parts of a split add up to the receipt total exactly. */
export function splitBalances(totalCents: number, partCents: readonly number[]): boolean {
  return partCents.reduce((sum, part) => sum + part, 0) === totalCents;
}

/** One currency's share of a set of receipts. */
export type CurrencyTotals = {
  currency: string;
  totalCents: number;
  taxCents: number;
  receipts: number;
};

/**
 * Totals a set of receipts, grouped by currency, largest first.
 *
 * Grouping is not a nicety. Cents are only comparable within one currency, so
 * a single sum across a mixed month produces a figure that is not money at
 * all — and it would be shown on the dashboard and written into the CSV an
 * artist hands their accountant.
 */
export function totalsByCurrency(
  receipts: readonly { currency: string; amountCents: number; taxCents: number | null }[],
): CurrencyTotals[] {
  const totals = new Map<string, CurrencyTotals>();

  for (const receipt of receipts) {
    const running = totals.get(receipt.currency) ?? {
      currency: receipt.currency,
      totalCents: 0,
      taxCents: 0,
      receipts: 0,
    };
    running.totalCents += receipt.amountCents;
    running.taxCents += receipt.taxCents ?? 0;
    running.receipts += 1;
    totals.set(receipt.currency, running);
  }

  return [...totals.values()].sort(
    (a, b) => b.totalCents - a.totalCents || a.currency.localeCompare(b.currency),
  );
}
