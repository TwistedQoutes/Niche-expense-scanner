import { describe, expect, it } from 'vitest';

import { centsToDecimalString, formatCents, parseAmountToCents } from '@/lib/money';

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
