import { PricingRuleKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { additionalUnits, calculatePricing, inputsFromService } from '@/lib/pricing/engine';
import { marginBpsFor } from '@/lib/money';
import { SERVICE_TEMPLATES } from '@/lib/services/templates';

describe('additionalUnits', () => {
  it('charges nothing inside the first unit', () => {
    expect(additionalUnits(800, 1000)).toBe(0);
    expect(additionalUnits(1000, 1000)).toBe(0);
  });

  it('rounds a partial unit up', () => {
    // A crew servicing 1,500 sq ft against a 1,000 sq ft unit does not do half
    // the extra work — they do the whole extra pass. Rounding down would
    // underprice every property that is not an exact multiple.
    expect(additionalUnits(1001, 1000)).toBe(1);
    expect(additionalUnits(1500, 1000)).toBe(1);
    expect(additionalUnits(2001, 1000)).toBe(2);
  });

  it('counts whole multiples exactly', () => {
    expect(additionalUnits(3000, 1000)).toBe(2);
  });

  it('refuses to divide by a zero unit size', () => {
    expect(additionalUnits(5000, 0)).toBe(0);
  });
});

describe('the worked example from the specification', () => {
  // Labour 2h x $35 = $70; materials $15; travel $10; overhead $20 → cost $115.
  // Desired margin 30% → customer price calculated automatically.
  const breakdown = calculatePricing({
    laborMinutes: 120,
    laborRateCents: 3500,
    materialCostCents: 1500,
    travelFeeCents: 1000,
    overheadCents: 2000,
    profitMarginBps: 3000,
  });

  it('reaches the documented estimated cost', () => {
    expect(breakdown.laborCostCents).toBe(7000);
    expect(breakdown.estimatedCostCents).toBe(11_500);
  });

  it('divides for margin rather than marking up', () => {
    // Cost plus 30% would be $149.50 and would earn only a 23% margin.
    expect(breakdown.totalCents).toBe(16_429);
    expect(breakdown.totalCents).not.toBe(14_950);
  });

  it('actually achieves the margin it targeted', () => {
    expect(breakdown.actualMarginBps).toBe(3000);
    expect(breakdown.profitCents).toBe(16_429 - 11_500);
  });

  it('shows its working', () => {
    const keys = breakdown.lines.map((line) => line.key);
    expect(keys).toEqual([
      'labor',
      'materials',
      'travel',
      'overhead',
      'estimated-cost',
      'margin',
      'total',
    ]);
  });
});

describe('area-based pricing', () => {
  // The documented lawn mowing template: $45 base, $10 per additional 1,000
  // sq ft, $45 minimum, 30 minutes of labour.
  const lawn = SERVICE_TEMPLATES.lawn_mowing!;

  it('matches the template for a small lawn', () => {
    const breakdown = calculatePricing({
      basePriceCents: lawn.basePriceCents,
      unitPriceCents: lawn.unitPriceCents,
      unitSizeSqFt: lawn.unitSizeSqFt,
      areaSqFt: 900,
      profitMarginBps: 0,
    });

    expect(breakdown.areaChargeCents).toBe(0);
    expect(breakdown.estimatedCostCents).toBe(4500);
  });

  it('adds one unit for a lawn just over the threshold', () => {
    const breakdown = calculatePricing({
      basePriceCents: lawn.basePriceCents,
      unitPriceCents: lawn.unitPriceCents,
      unitSizeSqFt: lawn.unitSizeSqFt,
      areaSqFt: 1200,
      profitMarginBps: 0,
    });

    expect(breakdown.areaChargeCents).toBe(1000);
    expect(breakdown.estimatedCostCents).toBe(5500);
  });

  it('scales with a large property', () => {
    const breakdown = calculatePricing({
      basePriceCents: lawn.basePriceCents,
      unitPriceCents: lawn.unitPriceCents,
      unitSizeSqFt: lawn.unitSizeSqFt,
      areaSqFt: 5000,
      profitMarginBps: 0,
    });

    // 4 additional units of 1,000 sq ft at $10.
    expect(breakdown.areaChargeCents).toBe(4000);
    expect(breakdown.estimatedCostCents).toBe(8500);
  });
});

describe('the minimum job price', () => {
  it('lifts a price that came out below the floor', () => {
    const breakdown = calculatePricing({
      laborMinutes: 10,
      laborRateCents: 3500,
      profitMarginBps: 3000,
      minimumJobCents: 4500,
    });

    expect(breakdown.minimumApplied).toBe(true);
    expect(breakdown.totalCents).toBe(4500);
    // Being lifted to the floor earns *more* than the target, not less.
    expect(breakdown.actualMarginBps).toBeGreaterThan(3000);
  });

  it('stays out of the way when the calculated price clears it', () => {
    const breakdown = calculatePricing({
      laborMinutes: 240,
      laborRateCents: 3500,
      profitMarginBps: 3000,
      minimumJobCents: 4500,
    });

    expect(breakdown.minimumApplied).toBe(false);
    expect(breakdown.totalCents).toBeGreaterThan(4500);
  });

  it('is a floor on the price, not on the discounted total', () => {
    // A discount below the minimum is a deliberate owner decision — a repeat
    // customer, a goodwill gesture — so it is allowed and simply reported.
    const breakdown = calculatePricing({
      basePriceCents: 5000,
      profitMarginBps: 0,
      minimumJobCents: 4500,
      discountCents: 2000,
    });

    expect(breakdown.totalCents).toBe(3000);
  });
});

describe('fees, discounts and tax', () => {
  it('adds fees before discounting', () => {
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 0,
      additionalFeesCents: 2500,
      discountCents: 500,
    });

    expect(breakdown.subtotalCents).toBe(12_000);
  });

  it('caps a discount at the price rather than going negative', () => {
    // A negative total is an invoice that owes the customer money.
    const breakdown = calculatePricing({
      basePriceCents: 5000,
      profitMarginBps: 0,
      discountCents: 9999,
    });

    expect(breakdown.totalCents).toBe(0);
    expect(breakdown.discountCents).toBe(5000);
    expect(breakdown.warnings.join(' ')).toMatch(/capped/i);
  });

  it('taxes what the customer actually pays, not the pre-discount price', () => {
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 0,
      discountCents: 2000,
      taxRateBps: 825,
      taxable: true,
    });

    expect(breakdown.subtotalCents).toBe(8000);
    expect(breakdown.taxCents).toBe(660); // 8.25% of $80.00
    expect(breakdown.totalCents).toBe(8660);
  });

  it('charges no tax on a service that is not taxable', () => {
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 0,
      taxRateBps: 825,
      taxable: false,
    });

    expect(breakdown.taxCents).toBe(0);
    expect(breakdown.totalCents).toBe(10_000);
  });

  it('keeps sales tax out of the profit figure', () => {
    // Tax is collected for the state and was never the business's money.
    // Counting it as revenue would overstate every margin on the dashboard.
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 0,
      taxRateBps: 1000,
      taxable: true,
    });

    expect(breakdown.totalCents).toBe(11_000);
    expect(breakdown.profitCents).toBe(0);
    expect(breakdown.actualMarginBps).toBe(0);
  });
});

describe('pricing rules', () => {
  const base = { basePriceCents: 10_000, profitMarginBps: 0 } as const;

  it('adds a flat surcharge', () => {
    const breakdown = calculatePricing({
      ...base,
      rules: [{ name: 'Weekend callout', kind: PricingRuleKind.FLAT_SURCHARGE, amount: 2500 }],
    });

    expect(breakdown.rulesCents).toBe(2500);
    expect(breakdown.estimatedCostCents).toBe(12_500);
  });

  it('adds a percentage surcharge on cost', () => {
    const breakdown = calculatePricing({
      ...base,
      rules: [{ name: 'Steep slope', kind: PricingRuleKind.PERCENT_SURCHARGE, amount: 1500 }],
    });

    expect(breakdown.rulesCents).toBe(1500); // 15% of $100
  });

  it('reads a seasonal multiplier as the amount above par', () => {
    const breakdown = calculatePricing({
      ...base,
      rules: [{ name: 'Peak season', kind: PricingRuleKind.SEASONAL_MULTIPLIER, amount: 11_000 }],
    });

    // 110% of cost means a 10% surcharge, not a 110% one.
    expect(breakdown.rulesCents).toBe(1000);
  });

  it('charges per mile', () => {
    const breakdown = calculatePricing({
      ...base,
      travelMiles: 12,
      rules: [{ name: 'Long haul', kind: PricingRuleKind.PER_MILE, amount: 75 }],
    });

    expect(breakdown.rulesCents).toBe(900); // 12 x $0.75
  });

  it('charges per 1,000 sq ft regardless of the service unit size', () => {
    const breakdown = calculatePricing({
      ...base,
      areaSqFt: 4500,
      unitSizeSqFt: 500,
      rules: [{ name: 'Debris removal', kind: PricingRuleKind.PER_UNIT_AREA, amount: 200 }],
    });

    expect(breakdown.rulesCents).toBe(900); // 4.5 x $2.00
  });

  it('honours a rule\'s range', () => {
    const rule = {
      name: 'Half acre and up',
      kind: PricingRuleKind.PERCENT_SURCHARGE,
      amount: 1500,
      minValue: 20_000,
    };

    // The range is checked against the cost for surcharge rules, so a small
    // cost falls outside it.
    expect(calculatePricing({ ...base, rules: [rule] }).rulesCents).toBe(0);
    expect(
      calculatePricing({ basePriceCents: 30_000, profitMarginBps: 0, rules: [rule] }).rulesCents,
    ).toBe(4500);
  });

  it('makes rules earn margin by adding them to cost', () => {
    // The financial decision: if a slope makes a job harder, the extra effort
    // should earn margin like every other hour. A surcharge on the *price*
    // would give the hardest jobs the thinnest margin.
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 3000,
      rules: [{ name: 'Steep slope', kind: PricingRuleKind.FLAT_SURCHARGE, amount: 2000 }],
    });

    expect(breakdown.estimatedCostCents).toBe(12_000);
    expect(breakdown.actualMarginBps).toBe(3000);
    expect(breakdown.totalCents).toBe(17_143); // 12000 / 0.7
  });

  it('applies several rules together', () => {
    const breakdown = calculatePricing({
      ...base,
      travelMiles: 10,
      rules: [
        { name: 'Callout', kind: PricingRuleKind.FLAT_SURCHARGE, amount: 1000 },
        { name: 'Mileage', kind: PricingRuleKind.PER_MILE, amount: 50 },
        { name: 'Difficulty', kind: PricingRuleKind.PERCENT_SURCHARGE, amount: 1000 },
      ],
    });

    // Percentages are taken on the cost before any rule, so the order rules are
    // listed in cannot change the total.
    expect(breakdown.rulesCents).toBe(1000 + 500 + 1000);
  });
});

describe('the owner override', () => {
  it('is honoured exactly', () => {
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 3000,
      overridePriceCents: 12_000,
    });

    expect(breakdown.overridden).toBe(true);
    expect(breakdown.subtotalCents).toBe(12_000);
    expect(breakdown.totalCents).toBe(12_000);
  });

  it('reports what the override did to the margin', () => {
    // The point of the feature: a deliberate discount should be visible as one
    // rather than quietly eroding the number the business was built on.
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 3000,
      overridePriceCents: 11_000,
    });

    expect(breakdown.marginPriceCents).toBe(14_286);
    expect(breakdown.actualMarginBps).toBe(marginBpsFor(11_000, 10_000));
    expect(breakdown.warnings.join(' ')).toMatch(/below your 30% target/);
  });

  it('warns when the override loses money', () => {
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 3000,
      overridePriceCents: 8000,
    });

    expect(breakdown.profitCents).toBe(-2000);
    expect(breakdown.warnings.join(' ')).toMatch(/lose money/i);
  });

  it('still charges tax on the overridden price', () => {
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 0,
      taxRateBps: 1000,
      taxable: true,
      overridePriceCents: 20_000,
    });

    expect(breakdown.taxCents).toBe(2000);
    expect(breakdown.totalCents).toBe(22_000);
  });

  it('treats a zero override as a real decision, not as absent', () => {
    // "This one is free" has to be expressible; falling back to the calculated
    // price would silently bill someone the owner meant to comp.
    const breakdown = calculatePricing({
      basePriceCents: 10_000,
      profitMarginBps: 3000,
      overridePriceCents: 0,
    });

    expect(breakdown.overridden).toBe(true);
    expect(breakdown.totalCents).toBe(0);
  });

  it('ignores null and undefined', () => {
    expect(calculatePricing({ basePriceCents: 100, overridePriceCents: null }).overridden).toBe(
      false,
    );
    expect(calculatePricing({ basePriceCents: 100 }).overridden).toBe(false);
  });
});

describe('robustness', () => {
  it('produces a coherent zero quote from no input', () => {
    const breakdown = calculatePricing({});

    expect(breakdown.estimatedCostCents).toBe(0);
    expect(breakdown.totalCents).toBe(0);
    expect(breakdown.warnings.join(' ')).toMatch(/Nothing has been priced/i);
  });

  it('treats negative inputs as zero rather than crediting them', () => {
    // A negative labour cost would be a quote that pays the customer to be
    // served. Clamping is the only safe reading of bad input.
    const breakdown = calculatePricing({
      laborMinutes: -60,
      laborRateCents: -3500,
      materialCostCents: -1000,
      basePriceCents: 5000,
      profitMarginBps: 0,
    });

    expect(breakdown.laborCostCents).toBe(0);
    expect(breakdown.materialCostCents).toBe(0);
    expect(breakdown.estimatedCostCents).toBe(5000);
  });

  it('survives non-finite numbers', () => {
    const breakdown = calculatePricing({
      basePriceCents: Number.NaN,
      laborRateCents: Number.POSITIVE_INFINITY,
      laborMinutes: 60,
      profitMarginBps: 3000,
    });

    expect(Number.isFinite(breakdown.totalCents)).toBe(true);
  });

  it('never produces a fractional cent', () => {
    const breakdown = calculatePricing({
      laborMinutes: 37,
      laborRateCents: 3333,
      areaSqFt: 2750,
      unitSizeSqFt: 900,
      unitPriceCents: 777,
      travelMiles: 7,
      travelPerMileCents: 61,
      profitMarginBps: 2750,
      taxRateBps: 637,
      taxable: true,
      rules: [{ name: 'Odd', kind: PricingRuleKind.PERCENT_SURCHARGE, amount: 333 }],
    });

    for (const line of breakdown.lines) {
      expect(Number.isInteger(line.amountCents)).toBe(true);
    }
    expect(Number.isInteger(breakdown.totalCents)).toBe(true);
    expect(Number.isInteger(breakdown.taxCents)).toBe(true);
  });

  it('keeps the total equal to the subtotal plus tax', () => {
    const breakdown = calculatePricing({
      basePriceCents: 12_345,
      profitMarginBps: 2200,
      additionalFeesCents: 999,
      discountCents: 501,
      taxRateBps: 725,
      taxable: true,
    });

    expect(breakdown.subtotalCents + breakdown.taxCents).toBe(breakdown.totalCents);
  });

  it('clamps a nonsensical margin instead of returning Infinity', () => {
    const breakdown = calculatePricing({ basePriceCents: 10_000, profitMarginBps: 10_000 });
    expect(Number.isFinite(breakdown.totalCents)).toBe(true);
  });
});

describe('inputsFromService', () => {
  const organization = {
    defaultLaborRateCents: 3500,
    defaultProfitMarginBps: 3000,
    defaultTravelFeeCents: 1000,
    defaultMinimumJobCents: 4500,
    defaultOverheadCents: 500,
    defaultTaxRateBps: 825,
  };

  const service = {
    basePriceCents: 4500,
    minimumPriceCents: 4500,
    unitPriceCents: 1000,
    unitSizeSqFt: 1000,
    estimatedMinutes: 30,
    laborRateCents: null,
    materialCostCents: 0,
    equipmentCostCents: 0,
    taxable: false,
  };

  it('falls back to the workspace labour rate', () => {
    expect(inputsFromService(service, organization).laborRateCents).toBe(3500);
  });

  it("lets a service's own labour rate win", () => {
    // A service naming its own rate is saying "this work is billed
    // differently"; the workspace default must not override that.
    expect(
      inputsFromService({ ...service, laborRateCents: 6500 }, organization).laborRateCents,
    ).toBe(6500);
  });

  it('charges no tax for a service marked not taxable', () => {
    expect(inputsFromService(service, organization).taxRateBps).toBe(0);
  });

  it('passes the tax rate through for a taxable service', () => {
    expect(inputsFromService({ ...service, taxable: true }, organization).taxRateBps).toBe(825);
  });

  it("uses the service's own minimum when it sets one", () => {
    expect(
      inputsFromService({ ...service, minimumPriceCents: 9000 }, organization).minimumJobCents,
    ).toBe(9000);
  });

  it('falls back to the workspace floor when the service sets none', () => {
    expect(
      inputsFromService({ ...service, minimumPriceCents: 0 }, organization).minimumJobCents,
    ).toBe(4500);
  });

  it('does not silently raise a deliberate loss leader', () => {
    // Taking the larger of the two would quietly reprice a service the owner
    // set cheap on purpose.
    expect(
      inputsFromService({ ...service, minimumPriceCents: 1000 }, organization).minimumJobCents,
    ).toBe(1000);
  });

  it('lets an explicit override beat everything', () => {
    const input = inputsFromService(service, organization, { profitMarginBps: 4000, areaSqFt: 3000 });
    expect(input.profitMarginBps).toBe(4000);
    expect(input.areaSqFt).toBe(3000);
  });

  it('prices the documented lawn mowing job end to end', () => {
    // A template is a starter catalogue entry, not a full Service row — it
    // carries no labour-rate override and no equipment cost.
    const input = inputsFromService(
      { ...SERVICE_TEMPLATES.lawn_mowing!, laborRateCents: null, equipmentCostCents: 0 },
      organization,
      { areaSqFt: 3000 },
    );
    const breakdown = calculatePricing(input);

    // $45 base + 2 extra units at $10 + 30min labour at $35 + $10 travel + $5 overhead.
    expect(breakdown.estimatedCostCents).toBe(4500 + 2000 + 1750 + 1000 + 500);
    expect(breakdown.actualMarginBps).toBe(3000);
    expect(breakdown.minimumApplied).toBe(false);
  });
});
