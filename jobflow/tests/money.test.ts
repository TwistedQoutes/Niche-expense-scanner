import { describe, expect, it } from 'vitest';

import {
  BPS_SCALE,
  apportionCents,
  applyBps,
  centsToDecimalString,
  formatBps,
  marginBpsFor,
  parseAmountToCents,
  priceForMargin,
  roundHalfAwayFromZero,
} from '@/lib/money';

describe('parseAmountToCents', () => {
  it.each([
    ['45', 4500],
    ['45.50', 4550],
    ['$45.50', 4550],
    ['1,234.56', 123456],
    ['12,50', 1250],
    ['0.01', 1],
    ['  99.99  ', 9999],
  ])('parses %s', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it('reads grouped thousands', () => {
    expect(parseAmountToCents('1,234')).toBe(123400);
    expect(parseAmountToCents('1.234,50')).toBe(123450);
  });

  it('rejects an ambiguous single dot before three digits', () => {
    // "12.345" is far more often a mistyped decimal than European grouping, and
    // guessing wrong is a 10x error in someone's pricing.
    expect(parseAmountToCents('12.345')).toBeNull();
  });

  it.each(['', 'abc', '45.678', '1,23,456', '--5'])('rejects %s', (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });

  it('rejects a non-finite number', () => {
    expect(parseAmountToCents(Number.NaN)).toBeNull();
    expect(parseAmountToCents(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('roundHalfAwayFromZero', () => {
  it('is symmetric about zero', () => {
    // Math.round(-0.5) is -0, which makes a discount and its reversal disagree
    // by a cent.
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });
});

describe('applyBps', () => {
  it('applies a basis-point rate', () => {
    expect(applyBps(10_000, 3000)).toBe(3000); // 30% of $100
    expect(applyBps(4500, 825)).toBe(371); // 8.25% sales tax on $45 → $3.71
  });

  it('returns zero for a zero rate', () => {
    expect(applyBps(12_345, 0)).toBe(0);
  });
});

describe('priceForMargin', () => {
  it('divides rather than marking up', () => {
    // The mistake this function exists to prevent: adding 30% to a $100 cost
    // gives $130, on which the margin is 23%, not 30%.
    expect(priceForMargin(10_000, 3000)).toBe(14_286);
    expect(marginBpsFor(14_286, 10_000)).toBe(3000);
  });

  it('leaves cost alone at zero margin', () => {
    expect(priceForMargin(11_500, 0)).toBe(11_500);
  });

  it('clamps a nonsensical margin instead of dividing by zero', () => {
    // 100% margin implies an infinite price. Returning Infinity would put
    // "$Infinity" on a customer's quote.
    expect(Number.isFinite(priceForMargin(10_000, BPS_SCALE))).toBe(true);
    expect(Number.isFinite(priceForMargin(10_000, 50_000))).toBe(true);
  });

  it('round-trips the documented worked example', () => {
    // Labour $70 + materials $15 + travel $10 + overhead $20 = $115 cost.
    const cost = 7000 + 1500 + 1000 + 2000;
    expect(cost).toBe(11_500);

    const price = priceForMargin(cost, 3000);
    expect(price).toBe(16_429); // $164.29
    expect(marginBpsFor(price, cost)).toBe(3000);
  });
});

describe('marginBpsFor', () => {
  it('is zero for a free job rather than negative infinity', () => {
    expect(marginBpsFor(0, 5000)).toBe(0);
  });

  it('goes negative when a price is below cost', () => {
    // A loss must read as a loss. Clamping it to zero would hide exactly the
    // thing an owner needs to see.
    expect(marginBpsFor(9000, 10_000)).toBeLessThan(0);
  });
});

describe('apportionCents', () => {
  it('never loses a cent', () => {
    expect(apportionCents(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(apportionCents(1000, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('splits proportionally', () => {
    expect(apportionCents(10_000, [3, 1])).toEqual([7500, 2500]);
  });

  it('divides evenly when no weight is usable', () => {
    expect(apportionCents(100, [0, 0, 0])).toEqual([34, 33, 33]);
  });

  it('handles an empty weight list', () => {
    expect(apportionCents(100, [])).toEqual([]);
  });

  it('is deterministic for tied remainders', () => {
    expect(apportionCents(100, [1, 1, 1])).toEqual(apportionCents(100, [1, 1, 1]));
  });

  it('rejects a fractional total', () => {
    expect(() => apportionCents(10.5, [1])).toThrow(/integer/i);
  });
});

describe('formatting', () => {
  it('writes plain decimals for CSV', () => {
    expect(centsToDecimalString(4550)).toBe('45.50');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(centsToDecimalString(-4550)).toBe('-45.50');
  });

  it('writes percentages without trailing zeros', () => {
    expect(formatBps(3000)).toBe('30%');
    expect(formatBps(825)).toBe('8.3%');
    expect(formatBps(0)).toBe('0%');
  });
});
