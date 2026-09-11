import { describe, expect, it } from 'vitest';

import {
  apportionCents,
  centsToDecimalString,
  formatCents,
  parseAmountToCents,
  splitBalances,
  totalsByCurrency,
} from '@/lib/money';

describe('parseAmountToCents', () => {
  it('parses plain and decimal amounts', () => {
    expect(parseAmountToCents('45')).toBe(4500);
    expect(parseAmountToCents('45.99')).toBe(4599);
    expect(parseAmountToCents('0.05')).toBe(5);
    expect(parseAmountToCents('12.5')).toBe(1250);
  });

  it('strips currency symbols and thousands separators', () => {
    expect(parseAmountToCents('$1,234.56')).toBe(123456);
    expect(parseAmountToCents('£64.99')).toBe(6499);
    expect(parseAmountToCents('€1.000,50')).toBe(100050);
  });

  it('treats a trailing comma as a decimal mark', () => {
    expect(parseAmountToCents('45,99')).toBe(4599);
  });

  it('avoids floating-point drift', () => {
    // 0.1 + 0.2 territory: 19.99 * 100 is 1998.9999... as a float.
    expect(parseAmountToCents('19.99')).toBe(1999);
    expect(parseAmountToCents('1.15')).toBe(115);
  });

  it('rejects anything that is not a number', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('12.345')).toBeNull();
    expect(parseAmountToCents('1.2.3')).toBeNull();
    expect(parseAmountToCents(Number.NaN)).toBeNull();
    expect(parseAmountToCents(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('centsToDecimalString', () => {
  it('always writes two decimal places', () => {
    expect(centsToDecimalString(4599)).toBe('45.99');
    expect(centsToDecimalString(4500)).toBe('45.00');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(centsToDecimalString(0)).toBe('0.00');
  });

  it('handles negative amounts', () => {
    expect(centsToDecimalString(-4599)).toBe('-45.99');
  });
});

describe('formatCents', () => {
  it('formats for display', () => {
    expect(formatCents(123456, 'USD')).toBe('$1,234.56');
  });

  it('degrades gracefully for an unknown currency code', () => {
    expect(formatCents(1000, 'XYZ')).toContain('10.00');
  });
});

describe('parseAmountToCents — locale separators', () => {
  it('reads European grouping with a comma decimal', () => {
    expect(parseAmountToCents('1.000,50')).toBe(100050);
    expect(parseAmountToCents('1.234.567,89')).toBe(123456789);
  });

  it('reads US grouping with a dot decimal', () => {
    expect(parseAmountToCents('1,234')).toBe(123400);
    expect(parseAmountToCents('1,234,567')).toBe(123456700);
  });

  it('rejects a lone dot before three digits as ambiguous', () => {
    // "12.345" is far more likely a mistyped decimal than European grouping,
    // and guessing wrong is a 10x error.
    expect(parseAmountToCents('12.345')).toBeNull();
  });

  it('rejects malformed grouping', () => {
    expect(parseAmountToCents('1,23.45')).toBeNull();
    expect(parseAmountToCents('1,2345.00')).toBeNull();
    expect(parseAmountToCents(',50')).toBeNull();
  });
});

describe('apportionCents', () => {
  it('preserves the total where naive division would lose a cent', () => {
    // 1000/3 = 333.33 each; flooring gives 999 and loses a penny.
    const parts = apportionCents(1000, [1, 1, 1]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });

  it('splits proportionally to the weights', () => {
    // A receipt of $143.05 over items of 71.98 / 24.50 / 35.97.
    const parts = apportionCents(14305, [7198, 2450, 3597]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(14305);
    // Tax is spread pro-rata, so each part is slightly above its bare item.
    expect(parts[0]).toBeGreaterThan(7198);
    expect(parts[1]).toBeGreaterThan(2450);
    expect(parts[2]).toBeGreaterThan(3597);
  });

  it('gives leftover cents to the largest remainders first', () => {
    // Exact shares 33.33.. / 66.66.. — the second is rounded down harder.
    expect(apportionCents(100, [1, 2])).toEqual([33, 67]);
  });

  it('is deterministic when remainders tie', () => {
    expect(apportionCents(100, [1, 1, 1])).toEqual(apportionCents(100, [1, 1, 1]));
    expect(apportionCents(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2]);
  });

  it('handles a single line by giving it everything', () => {
    expect(apportionCents(4599, [1])).toEqual([4599]);
    expect(apportionCents(4599, [0])).toEqual([4599]);
  });

  it('divides evenly when no weight is usable, rather than dropping the total', () => {
    const parts = apportionCents(1000, [0, 0, 0]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(1000);
  });

  it('ignores negative and non-finite weights instead of producing nonsense', () => {
    const parts = apportionCents(900, [100, -50, Number.NaN]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(900);
    expect(parts[0]).toBe(900);
  });

  it('returns an empty split for no weights', () => {
    expect(apportionCents(500, [])).toEqual([]);
  });

  it('handles a zero total', () => {
    expect(apportionCents(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it('rejects a non-integer amount rather than rounding silently', () => {
    expect(() => apportionCents(10.5, [1, 1])).toThrow();
  });

  it('always balances across a range of awkward totals', () => {
    for (const total of [1, 2, 7, 99, 101, 1234, 99999]) {
      for (const weights of [[1, 1], [1, 2, 3], [5, 5, 5, 5], [1, 1, 1, 1, 1, 1, 1]]) {
        const parts = apportionCents(total, weights);
        expect(splitBalances(total, parts)).toBe(true);
        // No part may be negative, however the remainder falls.
        expect(parts.every((part) => part >= 0)).toBe(true);
      }
    }
  });
});

describe('splitBalances', () => {
  it('detects a split that does not add up', () => {
    expect(splitBalances(1000, [500, 500])).toBe(true);
    expect(splitBalances(1000, [500, 499])).toBe(false);
    expect(splitBalances(1000, [])).toBe(false);
  });
});

describe('totalsByCurrency', () => {
  it('never adds one currency to another', () => {
    // The bug this guards: a single sum reported $198.39 for $133.40 plus
    // £64.99, and that figure reached both the dashboard and the CSV export.
    const totals = totalsByCurrency([
      { currency: 'USD', amountCents: 12_340, taxCents: 100 },
      { currency: 'GBP', amountCents: 6_499, taxCents: null },
      { currency: 'USD', amountCents: 1_000, taxCents: null },
    ]);

    expect(totals).toEqual([
      { currency: 'USD', totalCents: 13_340, taxCents: 100, receipts: 2 },
      { currency: 'GBP', totalCents: 6_499, taxCents: 0, receipts: 1 },
    ]);
  });

  it('orders by size so the headline figures describe the main currency', () => {
    const totals = totalsByCurrency([
      { currency: 'EUR', amountCents: 100, taxCents: null },
      { currency: 'USD', amountCents: 9_999, taxCents: null },
    ]);

    expect(totals.map((entry) => entry.currency)).toEqual(['USD', 'EUR']);
  });

  it('breaks ties on currency code, so the output is deterministic', () => {
    const totals = totalsByCurrency([
      { currency: 'USD', amountCents: 500, taxCents: null },
      { currency: 'GBP', amountCents: 500, taxCents: null },
      { currency: 'EUR', amountCents: 500, taxCents: null },
    ]);

    expect(totals.map((entry) => entry.currency)).toEqual(['EUR', 'GBP', 'USD']);
  });

  it('has nothing to report for an empty month', () => {
    expect(totalsByCurrency([])).toEqual([]);
  });
});
