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
