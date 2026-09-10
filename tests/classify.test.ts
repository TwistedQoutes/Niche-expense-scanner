import { describe, expect, it } from 'vitest';

import { MIN_CONFIDENCE, classifyExpense, normaliseText } from '@/lib/categories/classify';

describe('classifyExpense', () => {
  it('categorises needle purchases', () => {
    const result = classifyExpense({
      merchant: 'Kingpin Tattoo Supply',
      rawText: '2 x Cartridge Needles 3RL 20pk\n1 x Disposable Grip 25mm',
    });
    expect(result.category).toBe('NEEDLES');
    expect(result.confidence).toBeGreaterThan(MIN_CONFIDENCE);
  });

  it('categorises ink by brand name', () => {
    const result = classifyExpense({ merchant: 'Element Tattoo', rawText: 'Dynamic Black Ink 8oz\nWorld Famous set' });
    expect(result.category).toBe('INK');
  });

  it('categorises stencil and transfer supplies', () => {
    const result = classifyExpense({ rawText: 'Spirit Master thermal paper 100 sheets\nStencil Stuff 8oz' });
    expect(result.category).toBe('STENCIL_TRANSFER');
  });

  it('categorises PPE', () => {
    const result = classifyExpense({ merchant: 'MedSupply', rawText: 'Nitrile Gloves Box of 100 Medium' });
    expect(result.category).toBe('GLOVES_PPE');
  });

  it('categorises cleaning and sterilisation supplies', () => {
    const result = classifyExpense({
      rawText: 'Green Soap concentrate 1gal\nBarrier film 1200 sheets\nSharps container 1qt',
    });
    expect(result.category).toBe('STERILISATION');
  });

  it('categorises aftercare', () => {
    const result = classifyExpense({ rawText: 'Saniderm roll 6in x 8yd\nHustle Butter Deluxe 5oz' });
    expect(result.category).toBe('AFTERCARE');
  });

  it('categorises machines and power supplies', () => {
    const result = classifyExpense({ rawText: 'Cheyenne Sol Nova Unlimited rotary machine\nCritical Power supply' });
    expect(result.category).toBe('MACHINES');
  });

  it('categorises furniture — chairs and tables', () => {
    expect(classifyExpense({ rawText: 'TatSoul 370-S Client Chair' }).category).toBe('FURNITURE');
    expect(classifyExpense({ rawText: 'Hydraulic tattoo bed with armrest' }).category).toBe('FURNITURE');
    expect(classifyExpense({ rawText: 'Rolling cart and artist stool' }).category).toBe('FURNITURE');
  });

  it('categorises booth rent', () => {
    const result = classifyExpense({ merchant: 'Blackwork Studio', rawText: 'Monthly booth rent — station 3' });
    expect(result.category).toBe('STUDIO_RENT');
  });

  it('categorises licences and insurance', () => {
    expect(classifyExpense({ rawText: 'Bloodborne Pathogen certification renewal' }).category).toBe(
      'LICENCES_INSURANCE',
    );
    expect(classifyExpense({ rawText: 'Annual liability insurance premium' }).category).toBe('LICENCES_INSURANCE');
  });

  it('categorises conventions and travel', () => {
    const result = classifyExpense({ rawText: 'Tattoo convention booth deposit — Philadelphia' });
    expect(result.category).toBe('TRAVEL_CONVENTIONS');
  });

  it('categorises payment processing fees', () => {
    const result = classifyExpense({ merchant: 'Square', rawText: 'Monthly processing fee' });
    expect(result.category).toBe('SOFTWARE_FEES');
  });

  it('falls back to OTHER with zero confidence when there is no signal', () => {
    const result = classifyExpense({ merchant: 'Unknown Vendor', rawText: 'item 1\nitem 2' });
    expect(result.category).toBe('OTHER');
    expect(result.confidence).toBe(0);
  });

  it('handles empty input without throwing', () => {
    expect(classifyExpense({}).category).toBe('OTHER');
    expect(classifyExpense({ merchant: null, rawText: null, notes: null }).category).toBe('OTHER');
  });

  it('respects word boundaries so "ink" does not match "drinking"', () => {
    const result = classifyExpense({ rawText: 'drinking water for the waiting room' });
    expect(result.category).not.toBe('INK');
  });

  it('lets a line item outvote the supplier prior', () => {
    // Painful Pleasures is hinted as NEEDLES, but this receipt is clearly furniture.
    const result = classifyExpense({
      merchant: 'Painful Pleasures',
      rawText: 'Hydraulic tattoo chair\nArtist stool\nRolling cart',
    });
    expect(result.category).toBe('FURNITURE');
  });

  it('uses the supplier prior only when line items give nothing', () => {
    const result = classifyExpense({ merchant: 'TatSoul', rawText: 'order #4417\nqty 1' });
    expect(result.category).toBe('FURNITURE');
    expect(result.confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it('explains itself by reporting the matched terms', () => {
    const result = classifyExpense({ rawText: 'Nitrile gloves and face masks' });
    expect(result.matchedTerms.length).toBeGreaterThan(0);
    expect(result.matchedTerms.some((term) => term.includes('glove'))).toBe(true);
  });

  it('offers alternatives for a mixed receipt', () => {
    const result = classifyExpense({ rawText: 'Cartridge needles 3RL\nDynamic black ink\nGreen soap' });
    expect(result.alternatives.length).toBeGreaterThan(0);
  });
});

describe('normaliseText', () => {
  it('flattens OCR noise, punctuation and accents', () => {
    expect(normaliseText('  GLOVES**  \n  Nitríle   ')).toBe('gloves nitrile');
  });
});

describe('classifyExpense — reported confidence', () => {
  it('never reports an alternative as more likely than the winner', () => {
    // A mixed supply order scores several categories highly at once.
    const result = classifyExpense({
      merchant: 'Kingpin Tattoo Supply',
      rawText: 'Cartridge Needles 3RL 20pk\nDynamic Black Ink 8oz\nNitrile Gloves Box M',
    });

    for (const alternative of result.alternatives) {
      expect(alternative.confidence).toBeLessThanOrEqual(result.confidence);
    }
  });

  it('reports the text found on the receipt, never a regex', () => {
    const result = classifyExpense({ rawText: 'Cartridge needles 3RL 20pk' });
    for (const term of result.matchedTerms) {
      expect(term).not.toMatch(/[\\(){}[\]|]/);
    }
    expect(result.matchedTerms).toContain('3rl');
  });

  it('is more confident about a single-purpose receipt than a mixed one', () => {
    const focused = classifyExpense({ rawText: 'Cartridge needles 3RL 20pk\nCartridge needles 7RS 20pk' });
    const mixed = classifyExpense({
      rawText: 'Cartridge needles 3RL\nDynamic black ink\nNitrile gloves\nGreen soap',
    });
    expect(focused.confidence).toBeGreaterThan(mixed.confidence);
  });
});
