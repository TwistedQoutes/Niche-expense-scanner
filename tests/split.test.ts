import { describe, expect, it } from 'vitest';

import { suggestSplit } from '@/lib/expenses/split';
import { extractLineItems } from '@/lib/ocr/parse-receipt';

/** Verbatim Tesseract output from a rendered mixed supplier invoice. */
const MIXED_RECEIPT = [
  'KINGPIN TATTOO SUPPLY',
  '1234 Industrial Ave, Suite 5',
  'Cleveland, OH 44101',
  'Tel: (216) 555-6110',
  'INVOICE #: INV-88214',
  'Date: 09/03/2026',
  '2 Cartridge Needles 3RL 71.98',
  '1 Dynamic Black Ink 80z 24.50',
  '3 Nitrile Gloves Box M 35.97',
  'SUBTOTAL 132.45',
  'SALES TAX 8.0% 10.60',
  'TOTAL 143.05',
  'VISA **#% 4242 APPROVED',
  'Thank you for your order!',
].join('\n');

describe('extractLineItems', () => {
  it('reads the product lines and skips the rest', () => {
    const items = extractLineItems(MIXED_RECEIPT);
    expect(items).toEqual([
      { label: 'Cartridge Needles 3RL', amountCents: 7198 },
      { label: 'Dynamic Black Ink 80z', amountCents: 2450 },
      { label: 'Nitrile Gloves Box M', amountCents: 3597 },
    ]);
  });

  it('excludes totals, tax, payment and header lines', () => {
    const labels = extractLineItems(MIXED_RECEIPT).map((item) => item.label.toLowerCase());
    for (const forbidden of ['subtotal', 'total', 'tax', 'visa', 'invoice', 'date', 'tel']) {
      expect(labels.some((label) => label.includes(forbidden))).toBe(false);
    }
  });

  it('ignores lines whose description is mostly digits', () => {
    const items = extractLineItems(['SHOP', '4242 12.00', 'Green Soap 1gal 18.50'].join('\n'));
    expect(items).toEqual([{ label: 'Green Soap 1gal', amountCents: 1850 }]);
  });

  it('returns nothing for a receipt with no itemisation', () => {
    expect(extractLineItems(['CORNER SHOP', 'TOTAL 12.00'].join('\n'))).toEqual([]);
  });
});

describe('suggestSplit', () => {
  it('splits a mixed supplier order by category', () => {
    const lines = suggestSplit(MIXED_RECEIPT, 14305);
    expect(lines).not.toBeNull();

    const byCategory = Object.fromEntries(lines!.map((line) => [line.category, line.amountCents]));
    expect(Object.keys(byCategory).sort()).toEqual(['GLOVES_PPE', 'INK', 'NEEDLES']);
  });

  it('apportions the full total, so the split always matches the receipt', () => {
    const lines = suggestSplit(MIXED_RECEIPT, 14305)!;
    expect(lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(14305);
  });

  it('spreads tax pro-rata rather than leaving it unattributed', () => {
    const lines = suggestSplit(MIXED_RECEIPT, 14305)!;
    const needles = lines.find((line) => line.category === 'NEEDLES')!;
    // The bare item was 71.98; its share carries part of the 10.60 tax.
    expect(needles.amountCents).toBeGreaterThan(7198);
  });

  it('orders the largest share first', () => {
    const lines = suggestSplit(MIXED_RECEIPT, 14305)!;
    const amounts = lines.map((line) => line.amountCents);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it('groups several products of one category into a single line', () => {
    const receipt = [
      'SUPPLY CO',
      '1 Cartridge Needles 3RL 20.00',
      '1 Cartridge Needles 7RS 20.00',
      '1 Bugpin liners 11RL 20.00',
      '1 Dynamic Black Ink 40.00',
      'TOTAL 100.00',
    ].join('\n');

    const lines = suggestSplit(receipt, 10000)!;
    expect(lines).toHaveLength(2);
    const needles = lines.find((line) => line.category === 'NEEDLES')!;
    expect(needles.amountCents).toBe(6000);
    // The label names a couple of products then counts the rest.
    expect(needles.label).toMatch(/\+1 more$/);
  });

  it('declines to split a single-category receipt', () => {
    const receipt = [
      'SUPPLY CO',
      '1 Cartridge Needles 3RL 20.00',
      '1 Cartridge Needles 7RS 25.00',
      'TOTAL 45.00',
    ].join('\n');
    expect(suggestSplit(receipt, 4500)).toBeNull();
  });

  it('declines when nothing is recognised', () => {
    const receipt = ['MYSTERY CO', '1 Widget A 10.00', '1 Widget B 15.00', 'TOTAL 25.00'].join('\n');
    expect(suggestSplit(receipt, 2500)).toBeNull();
  });

  it('declines without a known total, rather than inventing one', () => {
    expect(suggestSplit(MIXED_RECEIPT, null)).toBeNull();
    expect(suggestSplit(MIXED_RECEIPT, 0)).toBeNull();
  });

  it('declines when there is only one line item', () => {
    expect(suggestSplit(['SUPPLY', '1 Dynamic Black Ink 24.50', 'TOTAL 24.50'].join('\n'), 2450)).toBeNull();
  });

  it('never proposes a zero-value line', () => {
    const lines = suggestSplit(MIXED_RECEIPT, 3);
    if (lines) expect(lines.every((line) => line.amountCents > 0)).toBe(true);
  });

  it('does not throw on OCR garbage', () => {
    expect(() => suggestSplit('~~~ \n |||| \n @@@ 8 8', 1000)).not.toThrow();
  });
});
