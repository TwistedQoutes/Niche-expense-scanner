import { describe, expect, it } from 'vitest';

import {
  createExpenseSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
} from '@/lib/validation';

const base = {
  merchant: 'Kingpin Tattoo Supply',
  amountCents: 14305,
  currency: 'USD',
  spentAt: '2026-09-03',
};

const line = (amountCents: number, category = 'NEEDLES') => ({
  amountCents,
  category,
  categoryConfidence: 0.8,
  categorySource: 'auto' as const,
});

describe('createExpenseSchema — the sum invariant', () => {
  it('accepts a single line covering the whole total', () => {
    const result = createExpenseSchema.safeParse({ ...base, lines: [line(14305)] });
    expect(result.success).toBe(true);
  });

  it('accepts a split whose parts add up exactly', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      lines: [line(7731), line(3864, 'GLOVES_PPE'), line(2710, 'INK')],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a split that is short of the total, naming the shortfall', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      lines: [line(7731), line(3864, 'GLOVES_PPE')],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((candidate) => candidate.path.includes('lines'));
      expect(issue?.message).toContain('27.10');
      expect(issue?.message).toMatch(/short/);
    }
  });

  it('rejects a split that exceeds the total, naming the excess', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      lines: [line(14305), line(100, 'INK')],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((candidate) => candidate.path.includes('lines'));
      expect(issue?.message).toContain('1.00');
      expect(issue?.message).toMatch(/exceed/);
    }
  });

  it('rejects a one-cent discrepancy — the whole point of integer money', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      lines: [line(7731), line(3864, 'GLOVES_PPE'), line(2709, 'INK')],
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one line', () => {
    const result = createExpenseSchema.safeParse({ ...base, lines: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a zero or negative part', () => {
    expect(createExpenseSchema.safeParse({ ...base, lines: [line(14305), line(0, 'INK')] }).success).toBe(
      false,
    );
    expect(
      createExpenseSchema.safeParse({ ...base, lines: [line(14405), line(-100, 'INK')] }).success,
    ).toBe(false);
  });

  it('rejects more parts than the cap allows', () => {
    const many = Array.from({ length: 13 }, () => line(100));
    const result = createExpenseSchema.safeParse({ ...base, amountCents: 1300, lines: many });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown category', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      lines: [{ ...line(14305), category: 'CRYPTO_MINING' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateExpenseSchema', () => {
  it('allows changing a field on its own', () => {
    expect(updateExpenseSchema.safeParse({ merchant: 'TatSoul' }).success).toBe(true);
  });

  it('accepts a balanced total and split together', () => {
    const result = updateExpenseSchema.safeParse({
      amountCents: 1000,
      lines: [line(600), line(400, 'INK')],
    });
    expect(result.success).toBe(true);
  });

  it('rejects lines sent without the total they must match', () => {
    // Without the total there is nothing to check the parts against, so the
    // invariant could be silently broken.
    const result = updateExpenseSchema.safeParse({ lines: [line(600), line(400, 'INK')] });
    expect(result.success).toBe(false);
  });

  it('rejects a total sent without its parts', () => {
    const result = updateExpenseSchema.safeParse({ amountCents: 5000 });
    expect(result.success).toBe(false);
  });

  it('rejects an unbalanced update', () => {
    const result = updateExpenseSchema.safeParse({
      amountCents: 1000,
      lines: [line(600), line(300, 'INK')],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty update', () => {
    expect(updateExpenseSchema.safeParse({}).success).toBe(false);
  });
});

describe('updateExpenseSchema — no field is injected that the caller did not send', () => {
  /**
   * Regression test. `.partial()` preserves a field's `.default()` and applies
   * it when the key is absent, so a default on the shared field list turned
   * every partial update into a currency rewrite: re-categorising a £64.99
   * expense silently reinterpreted it as $64.99.
   */
  it('does not inject a currency into a partial update', () => {
    const result = updateExpenseSchema.safeParse({ merchant: 'TatSoul' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ merchant: 'TatSoul' });
      expect(result.data).not.toHaveProperty('currency');
    }
  });

  it('still honours an explicitly sent currency', () => {
    const result = updateExpenseSchema.safeParse({ currency: 'gbp' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('GBP');
  });

  it('defaults the currency on create, where an absent one really means USD', () => {
    const result = createExpenseSchema.safeParse({ ...base, lines: [line(14305)] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('USD');
  });
});

describe('control characters never reach the database', () => {
  /**
   * Regression test for a crash, not a style rule.
   *
   * Postgres rejects NUL (0x00) inside a text value, so an unsanitised string
   * containing one did not fail validation — it crashed the query and returned
   * a 500. Six endpoints were affected, and any client could trigger it with a
   * single byte.
   */
  const NUL = String.fromCharCode(0);
  const BELL = String.fromCharCode(7);

  it('strips NUL from a merchant name', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      merchant: `King${NUL}pin`,
      lines: [line(14305)],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.merchant).toBe('Kingpin');
  });

  it('strips other invisible control characters too', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      merchant: `Tat${BELL}Soul`,
      lines: [line(14305)],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.merchant).toBe('TatSoul');
  });

  it('strips NUL from notes and line labels', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      notes: `some${NUL}note`,
      lines: [{ ...line(14305), label: `ink${NUL}` }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe('somenote');
      expect(result.data.lines[0]?.label).toBe('ink');
    }
  });

  it('collapses line breaks in single-line fields but keeps them in notes', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      merchant: 'King\npin',
      notes: 'line one\nline two',
      lines: [line(14305)],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.merchant).toBe('King pin');
      // OCR text and notes are legitimately multi-line.
      expect(result.data.notes).toBe('line one\nline two');
    }
  });

  it('rejects a merchant that is only control characters, rather than storing empty', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      merchant: NUL + NUL,
      lines: [line(14305)],
    });
    expect(result.success).toBe(false);
  });

  it('checks length after stripping, so padding cannot smuggle past the cap', () => {
    const result = createExpenseSchema.safeParse({
      ...base,
      merchant: NUL.repeat(500) + 'Kingpin',
      lines: [line(14305)],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.merchant).toBe('Kingpin');
  });
});

describe('listExpensesQuerySchema — pagination cursor', () => {
  it('accepts an id-shaped cursor', () => {
    const result = listExpensesQuerySchema.safeParse({ cursor: 'cmtwcrqvw0004n97d4b0z6yqn' });
    expect(result.success).toBe(true);
  });

  it('rejects a cursor containing a NUL byte rather than passing it to Postgres', () => {
    const result = listExpensesQuerySchema.safeParse({ cursor: String.fromCharCode(0) });
    expect(result.success).toBe(false);
  });

  it('rejects cursors with path or quote characters', () => {
    for (const cursor of ['../../etc/passwd', "a' OR 1=1--", 'a b', 'a/b']) {
      expect(listExpensesQuerySchema.safeParse({ cursor }).success).toBe(false);
    }
  });
});
