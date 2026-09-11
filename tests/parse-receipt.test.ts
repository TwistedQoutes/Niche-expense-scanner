import { describe, expect, it } from 'vitest';

import { looksLikeRefund, parseReceiptText, tidyMerchantName } from '@/lib/ocr/parse-receipt';

/** Fixed "now" so date plausibility checks are deterministic. */
const NOW = new Date('2026-09-10T12:00:00Z');

const KINGPIN_RECEIPT = `
KINGPIN TATTOO SUPPLY
1234 Industrial Ave, Suite 5
Cleveland, OH 44101
Tel: (216) 555-0110

INVOICE #  INV-88214
Date: 09/03/2026

QTY  ITEM                          AMOUNT
2    Cartridge Needles 3RL (20pk)   71.98
1    Dynamic Black Ink 8oz          24.50
3    Nitrile Gloves Box M           35.97

SUBTOTAL                           132.45
SALES TAX 8.0%                      10.60
TOTAL                              143.05

VISA **** 4242   APPROVED
Thank you for your order!
`;

describe('parseReceiptText', () => {
  it('extracts merchant, total, tax and date from a supplier invoice', () => {
    const parsed = parseReceiptText(KINGPIN_RECEIPT, NOW);

    expect(parsed.merchant.value).toBe('Kingpin Tattoo Supply');
    expect(parsed.amountCents.value).toBe(14305);
    expect(parsed.taxCents.value).toBe(1060);
    expect(parsed.spentAt.value).toBe('2026-09-03');
    expect(parsed.currency).toBe('USD');
    expect(parsed.amountCents.confidence).toBeGreaterThan(0.6);
  });

  it('prefers the total over the subtotal', () => {
    const parsed = parseReceiptText(
      ['CORNER PHARMACY', 'SUBTOTAL 88.00', 'TAX 7.04', 'TOTAL 95.04'].join('\n'),
      NOW,
    );
    expect(parsed.amountCents.value).toBe(9504);
  });

  it('ignores cash tendered and change due', () => {
    const parsed = parseReceiptText(
      ['SHOP SUPPLIES CO', 'TOTAL 23.40', 'CASH TENDERED 50.00', 'CHANGE DUE 26.60'].join('\n'),
      NOW,
    );
    expect(parsed.amountCents.value).toBe(2340);
  });

  it('does not mistake "total items" for a money total', () => {
    const parsed = parseReceiptText(
      ['ART STORE', 'TOTAL ITEMS 4', 'AMOUNT DUE 61.25'].join('\n'),
      NOW,
    );
    expect(parsed.amountCents.value).toBe(6125);
  });

  it('reads ISO dates in preference to anything else', () => {
    const parsed = parseReceiptText(['SUPPLY HOUSE', '2026-08-21', 'TOTAL 10.00'].join('\n'), NOW);
    expect(parsed.spentAt.value).toBe('2026-08-21');
    expect(parsed.spentAt.confidence).toBeGreaterThan(0.9);
  });

  it('reads textual month formats', () => {
    expect(parseReceiptText(['TATSOUL', 'Sep 1, 2026', 'TOTAL 5.00'].join('\n'), NOW).spentAt.value).toBe(
      '2026-09-01',
    );
    expect(parseReceiptText(['TATSOUL', '14 August 2026', 'TOTAL 5.00'].join('\n'), NOW).spentAt.value).toBe(
      '2026-08-14',
    );
  });

  it('uses a day value above 12 to resolve ambiguous numeric dates', () => {
    const parsed = parseReceiptText(['SUPPLY', 'Date 25/07/2026', 'TOTAL 5.00'].join('\n'), NOW);
    expect(parsed.spentAt.value).toBe('2026-07-25');
  });

  it('assumes US ordering when the date is genuinely ambiguous, with lower confidence', () => {
    const parsed = parseReceiptText(['SUPPLY', 'Date 03/04/2026', 'TOTAL 5.00'].join('\n'), NOW);
    expect(parsed.spentAt.value).toBe('2026-03-04');
    expect(parsed.spentAt.confidence).toBeLessThan(0.8);
  });

  it('rejects implausible future dates', () => {
    const parsed = parseReceiptText(['SUPPLY', 'Date 01/01/2099', 'TOTAL 5.00'].join('\n'), NOW);
    expect(parsed.spentAt.value).toBeNull();
  });

  it('detects non-USD currency', () => {
    const parsed = parseReceiptText(['KILLER INK LTD', 'TOTAL £64.99'].join('\n'), NOW);
    expect(parsed.currency).toBe('GBP');
    expect(parsed.amountCents.value).toBe(6499);
  });

  it('drops a tax value that is not smaller than the total', () => {
    const parsed = parseReceiptText(['SUPPLY', 'TAX 90.00', 'TOTAL 45.00'].join('\n'), NOW);
    expect(parsed.taxCents.value).toBeNull();
  });

  it('falls back to the largest amount when nothing is labelled, at low confidence', () => {
    const parsed = parseReceiptText(['MARKET', '3.50', '$41.20', '7.00'].join('\n'), NOW);
    expect(parsed.amountCents.value).toBe(4120);
    expect(parsed.amountCents.confidence).toBeLessThan(0.5);
  });

  it('skips address and phone lines when choosing the merchant', () => {
    const parsed = parseReceiptText(
      ['RECEIPT', '742 Evergreen Terrace', '(555) 010-2030', 'Painful Pleasures Inc', 'TOTAL 12.00'].join('\n'),
      NOW,
    );
    expect(parsed.merchant.value).toBe('Painful Pleasures Inc');
  });

  it('returns nulls rather than throwing on unusable input', () => {
    const parsed = parseReceiptText('', NOW);
    expect(parsed.merchant.value).toBeNull();
    expect(parsed.amountCents.value).toBeNull();
    expect(parsed.spentAt.value).toBeNull();
    expect(parsed.taxCents.value).toBeNull();
  });

  it('does not crash on OCR garbage', () => {
    expect(() => parseReceiptText('~~~ \n |||| \n @@@@ 8 8 8', NOW)).not.toThrow();
  });
});

describe('tidyMerchantName', () => {
  it('title-cases shouty names and strips OCR artefacts', () => {
    expect(tidyMerchantName('KINGPIN TATTOO SUPPLY ***')).toBe('Kingpin Tattoo Supply');
  });

  it('leaves already mixed-case names alone', () => {
    expect(tidyMerchantName('TatSoul Empire')).toBe('TatSoul Empire');
  });
});

describe('parseReceiptText — real OCR noise', () => {
  /**
   * Verbatim output from Tesseract reading a rendered receipt image, including
   * its actual mistakes: 0→8 in the date, 0→6 in the phone number, "8oz" read
   * as "80z", and "****" as "**#%".
   */
  const OCR_OUTPUT = [
    'KINGPIN TATTOO SUPPLY',
    '1234 Industrial Ave, Suite 5',
    'Cleveland, OH 44101',
    'Tel: (216) 555-6110',
    'INVOICE #: INV-88214',
    'Date: 89/03/2026',
    '2 Cartridge Needles 3RL 71.98',
    '1 Dynamic Black Ink 80z 24.50',
    '3 Nitrile Gloves Box M 35.97',
    'SUBTOTAL 132.45',
    'SALES TAX 8.0% 10.60',
    'TOTAL 143.05',
    'VISA **#% 4242 APPROVED',
    'Thank you for your order!',
  ].join('\n');

  it('reads merchant, total and tax from genuinely noisy OCR output', () => {
    const parsed = parseReceiptText(OCR_OUTPUT, NOW);
    expect(parsed.merchant.value).toBe('Kingpin Tattoo Supply');
    expect(parsed.amountCents.value).toBe(14305);
    expect(parsed.taxCents.value).toBe(1060);
  });

  it('repairs a single mis-read digit in the date', () => {
    // "89/03/2026" is impossible; flipping the 8 back to 0 is the only repair
    // that yields a real date.
    const parsed = parseReceiptText(OCR_OUTPUT, NOW);
    expect(parsed.spentAt.value).toBe('2026-09-03');
    // Low enough that the review screen flags it.
    expect(parsed.spentAt.confidence).toBeLessThan(0.6);
  });

  it('refuses to guess when more than one repair is plausible', () => {
    // "11/12/2026" already parses, so take something impossible whose repairs
    // are genuinely ambiguous: 18/18 could be 10/18 or 18/10 among others.
    const parsed = parseReceiptText(['SUPPLY CO', 'Date 88/88/2026', 'TOTAL 5.00'].join('\n'), NOW);
    expect(parsed.spentAt.value).toBeNull();
  });

  it('does not invent a date when the receipt has none', () => {
    const parsed = parseReceiptText(['SUPPLY CO', 'TOTAL 5.00'].join('\n'), NOW);
    expect(parsed.spentAt.value).toBeNull();
  });
});

describe('refunds and credits', () => {
  it('does not turn a negative total into a positive expense', () => {
    // The bug: AMOUNT_PATTERN matches from the first digit, so the minus sign
    // sat outside the match and "TOTAL -45.00" became a $45.00 purchase.
    const parsed = parseReceiptText('Kingpin Tattoo Supply\nTOTAL -45.00\n');
    expect(parsed.amountCents.value).toBeNull();
  });

  it('ignores accounting brackets too', () => {
    const parsed = parseReceiptText('Kingpin Tattoo Supply\nTOTAL (45.00)\n');
    expect(parsed.amountCents.value).toBeNull();
  });

  it('ignores a trailing minus, which is how some tills print a credit', () => {
    const parsed = parseReceiptText('Kingpin Tattoo Supply\nTOTAL 45.00-\n');
    expect(parsed.amountCents.value).toBeNull();
  });

  it('still reads an ordinary total', () => {
    const parsed = parseReceiptText('Kingpin Tattoo Supply\nTOTAL 45.00\n');
    expect(parsed.amountCents.value).toBe(4500);
  });

  it('flags text that reads like a refund', () => {
    expect(looksLikeRefund('REFUND\nTOTAL 45.00')).toBe(true);
    expect(looksLikeRefund('Credit Note 118\nTOTAL 45.00')).toBe(true);
    expect(looksLikeRefund('TOTAL -45.00')).toBe(true);
  });

  it('does not flag an ordinary receipt', () => {
    expect(looksLikeRefund('Kingpin Tattoo Supply\nGloves 12.00\nTOTAL 45.00')).toBe(false);
    // "Returns accepted within 30 days" is small print, not a refund.
    expect(looksLikeRefund('TOTAL 45.00\nReturns accepted within 30 days')).toBe(false);
  });
});
