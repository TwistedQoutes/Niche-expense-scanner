import { PricingRuleKind } from '@prisma/client';

import { BPS_SCALE, applyBps, marginBpsFor, priceForMargin, roundHalfAwayFromZero } from '@/lib/money';

/**
 * The pricing engine.
 *
 * One pure function. No database, no clock, no randomness — the same inputs
 * always produce the same quote, which is what makes it testable and what makes
 * a price defensible six months later when a customer asks how it was reached.
 *
 * The single most important thing in here is that a target margin is reached by
 * **division, not markup**. Adding 30% to a $100 cost gives $130, on which the
 * profit is $30 of $130 — a 23% margin. To actually keep 30% of the sale the
 * divisor is (1 − margin): 100 / 0.70 = $142.86. Operators who quote the first
 * number and budget for the second lose the difference on every single job, and
 * it is the most common pricing mistake in the trades.
 *
 * The second is that every step is emitted as a labelled line. The spec asked
 * for a transparent formula; a total with no working is something an owner
 * cannot check, adjust, or explain to a customer standing next to them.
 */

/** One row of the working, for display. */
export type BreakdownLine = {
  /** Machine-readable, so the UI can style or group without parsing labels. */
  key: string;
  label: string;
  /** The arithmetic in words: "2h 0m x $35.00/hr". Empty when self-evident. */
  detail?: string;
  amountCents: number;
  /** Cost lines build up what the job costs us; the rest shape the price. */
  kind: 'cost' | 'price' | 'adjustment' | 'total';
};

export type PricingRuleInput = {
  id?: string;
  name: string;
  kind: PricingRuleKind;
  /** Cents for the cash kinds, basis points for the proportional ones. */
  amount: number;
  minValue?: number | null;
  maxValue?: number | null;
};

export type PricingInput = {
  // --- What is being sold -------------------------------------------------
  /** Base charge for the service before any area or rule adjustment. */
  basePriceCents?: number;
  /** Area of the property being serviced, in square feet. */
  areaSqFt?: number;
  /** Charge per `unitSizeSqFt` beyond the first unit, which the base covers. */
  unitPriceCents?: number;
  unitSizeSqFt?: number;

  // --- What it costs us ---------------------------------------------------
  laborMinutes?: number;
  laborRateCents?: number;
  materialCostCents?: number;
  equipmentCostCents?: number;

  travelMiles?: number;
  /** Flat call-out fee, charged once regardless of distance. */
  travelFeeCents?: number;
  /** Optional mileage on top of the flat fee. */
  travelPerMileCents?: number;

  overheadCents?: number;

  // --- Targets ------------------------------------------------------------
  /** Desired margin in basis points. 3000 is 30%. */
  profitMarginBps?: number;
  /** The floor below which this business will not take the job. */
  minimumJobCents?: number;

  // --- Adjustments --------------------------------------------------------
  additionalFeesCents?: number;
  discountCents?: number;
  taxRateBps?: number;
  taxable?: boolean;

  rules?: PricingRuleInput[];

  /**
   * A price the owner typed over the calculated one.
   *
   * Honoured exactly. The engine then reports what that price does to the
   * margin, so a deliberate discount is visible as one rather than quietly
   * eroding the number the business was built on.
   */
  overridePriceCents?: number | null;
};

export type PricingBreakdown = {
  lines: BreakdownLine[];

  // Cost components
  basePriceCents: number;
  areaChargeCents: number;
  laborCostCents: number;
  materialCostCents: number;
  equipmentCostCents: number;
  travelCostCents: number;
  overheadCents: number;
  rulesCents: number;
  /** What the job costs to perform, all in. */
  estimatedCostCents: number;

  // Price derivation
  targetMarginBps: number;
  /** Cost marked up to hit the target margin, before floors and adjustments. */
  marginPriceCents: number;
  minimumJobCents: number;
  minimumApplied: boolean;

  additionalFeesCents: number;
  discountCents: number;
  subtotalCents: number;
  taxRateBps: number;
  taxCents: number;
  /** What the customer pays. */
  totalCents: number;

  // Outcome
  profitCents: number;
  /** The margin actually achieved, which may differ from the target. */
  actualMarginBps: number;
  overridden: boolean;
  /** Non-fatal things the owner should see before sending this. */
  warnings: string[];
};

function value(input: number | null | undefined, fallback = 0): number {
  return typeof input === 'number' && Number.isFinite(input) ? input : fallback;
}

/**
 * Additional area units beyond the one the base price covers.
 *
 * Rounded **up**, because a crew servicing 1,500 sq ft against a 1,000 sq ft
 * unit does not do half the extra work — they do the whole extra pass. Rounding
 * down would systematically underprice every property that is not an exact
 * multiple of the unit.
 */
export function additionalUnits(areaSqFt: number, unitSizeSqFt: number): number {
  if (unitSizeSqFt <= 0) return 0;
  const extra = areaSqFt - unitSizeSqFt;
  if (extra <= 0) return 0;
  return Math.ceil(extra / unitSizeSqFt);
}

/** Whether a rule's range covers the driving quantity. */
function ruleApplies(rule: PricingRuleInput, quantity: number): boolean {
  if (rule.minValue !== null && rule.minValue !== undefined && quantity < rule.minValue) {
    return false;
  }
  if (rule.maxValue !== null && rule.maxValue !== undefined && quantity > rule.maxValue) {
    return false;
  }
  return true;
}

/** Reference unit for area-driven rules, so one rule means one thing. */
const RULE_AREA_UNIT_SQ_FT = 1_000;

export function calculatePricing(input: PricingInput): PricingBreakdown {
  const lines: BreakdownLine[] = [];
  const warnings: string[] = [];

  const areaSqFt = Math.max(0, value(input.areaSqFt));
  const unitSizeSqFt = Math.max(1, value(input.unitSizeSqFt, 1_000));
  const unitPriceCents = Math.max(0, value(input.unitPriceCents));
  const basePriceCents = Math.max(0, value(input.basePriceCents));

  // ── Cost build-up ──────────────────────────────────────────────────────
  //
  // "Base price" is treated as a cost component rather than a price, so the
  // target margin applies on top of it. A base that already included profit
  // would be marked up a second time.

  if (basePriceCents > 0) {
    lines.push({
      key: 'base',
      label: 'Base charge',
      amountCents: basePriceCents,
      kind: 'cost',
    });
  }

  const units = additionalUnits(areaSqFt, unitSizeSqFt);
  const areaChargeCents = units * unitPriceCents;

  if (areaChargeCents > 0) {
    lines.push({
      key: 'area',
      label: 'Extra area',
      detail: `${units} x ${unitSizeSqFt.toLocaleString()} sq ft beyond the first ${unitSizeSqFt.toLocaleString()}`,
      amountCents: areaChargeCents,
      kind: 'cost',
    });
  }

  const laborMinutes = Math.max(0, value(input.laborMinutes));
  const laborRateCents = Math.max(0, value(input.laborRateCents));
  // Rate is per hour; minutes are the honest unit for a 20-minute mow.
  const laborCostCents = roundHalfAwayFromZero((laborMinutes / 60) * laborRateCents);

  if (laborCostCents > 0) {
    const hours = Math.floor(laborMinutes / 60);
    const minutes = laborMinutes % 60;
    lines.push({
      key: 'labor',
      label: 'Labour',
      detail: `${hours}h ${minutes}m at ${(laborRateCents / 100).toFixed(2)}/hr`,
      amountCents: laborCostCents,
      kind: 'cost',
    });
  }

  const materialCostCents = Math.max(0, value(input.materialCostCents));
  if (materialCostCents > 0) {
    lines.push({
      key: 'materials',
      label: 'Materials',
      amountCents: materialCostCents,
      kind: 'cost',
    });
  }

  const equipmentCostCents = Math.max(0, value(input.equipmentCostCents));
  if (equipmentCostCents > 0) {
    lines.push({
      key: 'equipment',
      label: 'Equipment',
      amountCents: equipmentCostCents,
      kind: 'cost',
    });
  }

  const travelMiles = Math.max(0, value(input.travelMiles));
  const travelFeeCents = Math.max(0, value(input.travelFeeCents));
  const travelPerMileCents = Math.max(0, value(input.travelPerMileCents));
  const travelCostCents = travelFeeCents + roundHalfAwayFromZero(travelMiles * travelPerMileCents);

  if (travelCostCents > 0) {
    lines.push({
      key: 'travel',
      label: 'Travel',
      detail:
        travelPerMileCents > 0
          ? `${travelMiles} miles at ${(travelPerMileCents / 100).toFixed(2)}/mile plus call-out`
          : undefined,
      amountCents: travelCostCents,
      kind: 'cost',
    });
  }

  const overheadCents = Math.max(0, value(input.overheadCents));
  if (overheadCents > 0) {
    lines.push({
      key: 'overhead',
      label: 'Overhead',
      amountCents: overheadCents,
      kind: 'cost',
    });
  }

  // ── Pricing rules ──────────────────────────────────────────────────────
  //
  // Rules add to **cost**, not to the price. That is a deliberate financial
  // decision: if a steep slope or a winter callout makes a job harder, the
  // extra effort should earn margin like every other hour does. Adding a
  // surcharge to the price instead would mean the hardest jobs are the ones
  // with the thinnest margin — exactly backwards.
  const costBeforeRules =
    basePriceCents +
    areaChargeCents +
    laborCostCents +
    materialCostCents +
    equipmentCostCents +
    travelCostCents +
    overheadCents;

  let rulesCents = 0;

  for (const rule of input.rules ?? []) {
    let amountCents = 0;

    switch (rule.kind) {
      case PricingRuleKind.PER_UNIT_AREA: {
        if (!ruleApplies(rule, areaSqFt)) continue;
        // Cents per 1,000 sq ft, a fixed reference so one rule means one thing
        // regardless of the service's own unit size.
        amountCents = roundHalfAwayFromZero((areaSqFt / RULE_AREA_UNIT_SQ_FT) * rule.amount);
        break;
      }
      case PricingRuleKind.PER_MILE: {
        if (!ruleApplies(rule, travelMiles)) continue;
        amountCents = roundHalfAwayFromZero(travelMiles * rule.amount);
        break;
      }
      case PricingRuleKind.FLAT_SURCHARGE: {
        if (!ruleApplies(rule, costBeforeRules)) continue;
        amountCents = rule.amount;
        break;
      }
      case PricingRuleKind.PERCENT_SURCHARGE: {
        if (!ruleApplies(rule, costBeforeRules)) continue;
        amountCents = applyBps(costBeforeRules, rule.amount);
        break;
      }
      case PricingRuleKind.SEASONAL_MULTIPLIER: {
        if (!ruleApplies(rule, costBeforeRules)) continue;
        // A multiplier in basis points: 11000 is 110%, so the surcharge is the
        // 10% above par. Expressed as a delta so it reads like the others.
        amountCents = applyBps(costBeforeRules, rule.amount - BPS_SCALE);
        break;
      }
      default:
        continue;
    }

    if (amountCents === 0) continue;

    rulesCents += amountCents;
    lines.push({
      key: `rule:${rule.id ?? rule.name}`,
      label: rule.name,
      amountCents,
      kind: 'cost',
    });
  }

  const estimatedCostCents = costBeforeRules + rulesCents;

  lines.push({
    key: 'estimated-cost',
    label: 'Estimated cost',
    detail: 'What this job costs you to perform',
    amountCents: estimatedCostCents,
    kind: 'total',
  });

  // ── Price derivation ───────────────────────────────────────────────────

  const targetMarginBps = Math.max(0, value(input.profitMarginBps));
  const marginPriceCents = priceForMargin(estimatedCostCents, targetMarginBps);

  if (targetMarginBps > 0) {
    lines.push({
      key: 'margin',
      label: `Price at ${(targetMarginBps / 100).toFixed(targetMarginBps % 100 === 0 ? 0 : 1)}% margin`,
      detail: 'Cost divided by (1 − margin), not cost plus margin',
      amountCents: marginPriceCents,
      kind: 'price',
    });
  }

  const minimumJobCents = Math.max(0, value(input.minimumJobCents));
  const minimumApplied = minimumJobCents > marginPriceCents;
  let priceCents = minimumApplied ? minimumJobCents : marginPriceCents;

  if (minimumApplied) {
    lines.push({
      key: 'minimum',
      label: 'Minimum job price applied',
      detail: 'The calculated price was below the floor you set',
      amountCents: minimumJobCents,
      kind: 'price',
    });
  }

  const additionalFeesCents = Math.max(0, value(input.additionalFeesCents));
  if (additionalFeesCents > 0) {
    priceCents += additionalFeesCents;
    lines.push({
      key: 'fees',
      label: 'Additional fees',
      amountCents: additionalFeesCents,
      kind: 'adjustment',
    });
  }

  const requestedDiscount = Math.max(0, value(input.discountCents));
  // A discount larger than the price would produce a negative total — an
  // invoice that owes the customer money. Clamp it and say so.
  const discountCents = Math.min(requestedDiscount, priceCents);
  if (requestedDiscount > discountCents) {
    warnings.push('The discount was larger than the price, so it has been capped.');
  }

  if (discountCents > 0) {
    priceCents -= discountCents;
    lines.push({
      key: 'discount',
      label: 'Discount',
      amountCents: -discountCents,
      kind: 'adjustment',
    });
  }

  const overridden =
    typeof input.overridePriceCents === 'number' &&
    Number.isFinite(input.overridePriceCents) &&
    input.overridePriceCents >= 0;

  const subtotalCents = overridden ? input.overridePriceCents! : priceCents;

  if (overridden) {
    lines.push({
      key: 'override',
      label: 'Price set by hand',
      detail: 'Overrides the calculated price',
      amountCents: subtotalCents,
      kind: 'price',
    });
  }

  // ── Tax ────────────────────────────────────────────────────────────────
  //
  // On the discounted subtotal, never on the pre-discount price: tax follows
  // what the customer actually pays.
  const taxRateBps = input.taxable === false ? 0 : Math.max(0, value(input.taxRateBps));
  const taxCents = applyBps(subtotalCents, taxRateBps);

  if (taxCents > 0) {
    lines.push({
      key: 'tax',
      label: `Tax at ${(taxRateBps / 100).toFixed(taxRateBps % 100 === 0 ? 0 : 2)}%`,
      amountCents: taxCents,
      kind: 'adjustment',
    });
  }

  const totalCents = subtotalCents + taxCents;

  lines.push({
    key: 'total',
    label: 'Customer price',
    amountCents: totalCents,
    kind: 'total',
  });

  // ── Outcome ────────────────────────────────────────────────────────────
  //
  // Profit is measured against the pre-tax subtotal. Sales tax is collected on
  // behalf of the state and was never the business's money, so counting it as
  // revenue would overstate every margin on the dashboard.
  const profitCents = subtotalCents - estimatedCostCents;
  const actualMarginBps = marginBpsFor(subtotalCents, estimatedCostCents);

  if (profitCents < 0) {
    warnings.push('This price is below what the job costs you. You would lose money on it.');
  } else if (targetMarginBps > 0 && actualMarginBps < targetMarginBps - 100) {
    warnings.push(
      `This price earns ${(actualMarginBps / 100).toFixed(1)}% margin, below your ${(
        targetMarginBps / 100
      ).toFixed(0)}% target.`,
    );
  }

  if (estimatedCostCents === 0 && subtotalCents === 0) {
    warnings.push('Nothing has been priced yet — add labour, materials or a base charge.');
  }

  return {
    lines,
    basePriceCents,
    areaChargeCents,
    laborCostCents,
    materialCostCents,
    equipmentCostCents,
    travelCostCents,
    overheadCents,
    rulesCents,
    estimatedCostCents,
    targetMarginBps,
    marginPriceCents,
    minimumJobCents,
    minimumApplied,
    additionalFeesCents,
    discountCents,
    subtotalCents,
    taxRateBps,
    taxCents,
    totalCents,
    profitCents,
    actualMarginBps,
    overridden,
    warnings,
  };
}

/**
 * Builds engine inputs from a service and the organization's defaults.
 *
 * Precedence is service, then organization, then zero. A service that names its
 * own labour rate is saying "this work is billed differently", and that has to
 * win over the workspace default or the override is pointless.
 */
export function inputsFromService(
  service: {
    basePriceCents: number;
    minimumPriceCents: number;
    unitPriceCents: number;
    unitSizeSqFt: number;
    estimatedMinutes: number;
    laborRateCents: number | null;
    materialCostCents: number;
    equipmentCostCents: number;
    taxable: boolean;
  },
  organization: {
    defaultLaborRateCents: number;
    defaultProfitMarginBps: number;
    defaultTravelFeeCents: number;
    defaultMinimumJobCents: number;
    defaultOverheadCents: number;
    defaultTaxRateBps: number;
  },
  overrides: Partial<PricingInput> = {},
): PricingInput {
  return {
    basePriceCents: service.basePriceCents,
    unitPriceCents: service.unitPriceCents,
    unitSizeSqFt: service.unitSizeSqFt,
    laborMinutes: service.estimatedMinutes,
    laborRateCents: service.laborRateCents ?? organization.defaultLaborRateCents,
    materialCostCents: service.materialCostCents,
    equipmentCostCents: service.equipmentCostCents,
    travelFeeCents: organization.defaultTravelFeeCents,
    overheadCents: organization.defaultOverheadCents,
    profitMarginBps: organization.defaultProfitMarginBps,
    // The service's own minimum wins when it sets one; otherwise the workspace
    // floor applies. Taking the larger would quietly raise a service that was
    // deliberately priced cheap as a loss leader.
    minimumJobCents:
      service.minimumPriceCents > 0 ? service.minimumPriceCents : organization.defaultMinimumJobCents,
    taxable: service.taxable,
    taxRateBps: service.taxable ? organization.defaultTaxRateBps : 0,
    ...overrides,
  };
}
