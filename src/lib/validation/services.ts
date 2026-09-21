import { PricingRuleKind } from '@prisma/client';
import { z } from 'zod';

import { bpsSchema, centsSchema, idSchema, multiLineText, singleLineText } from '@/lib/validation/common';

/**
 * Service and pricing-rule schemas.
 *
 * These validate the numbers a business prices its work with, so the bounds are
 * tighter than elsewhere: a typo here does not produce a bad record, it produces
 * a bad quote that a customer accepts.
 */

const serviceFields = {
  name: singleLineText(120, 'That service name is too long.').pipe(
    z.string().min(2, 'Give the service a name.'),
  ),
  description: multiLineText(1000, 'That description is too long.')
    .optional()
    .transform((value) => (value ? value : null)),

  basePriceCents: centsSchema,
  minimumPriceCents: centsSchema,
  unitPriceCents: centsSchema,
  /**
   * Area increment for unit pricing. At least 1 so the engine cannot divide by
   * zero, and capped at an acre so a mistyped value does not silently switch
   * off area pricing altogether.
   */
  unitSizeSqFt: z
    .number()
    .int('Use a whole number of square feet.')
    .min(1, 'The area increment must be at least 1 sq ft.')
    .max(43_560, 'Use an increment of an acre or less.'),

  estimatedMinutes: z
    .number()
    .int('Use a whole number of minutes.')
    .min(0, 'That cannot be negative.')
    .max(60 * 24 * 5, 'That is more than five days of labour — check the value.'),

  /** Null means "use the workspace default". */
  laborRateCents: centsSchema.nullable().optional(),
  materialCostCents: centsSchema,
  equipmentCostCents: centsSchema,

  taxable: z.boolean(),
  active: z.boolean(),
};

/**
 * A minimum below the base price is *inert*, not invalid.
 *
 * The base is a cost component, so the margin-derived price always clears it
 * and the floor never fires. This originally rejected it as an error — which
 * meant an owner could not edit a service that shipped with their own
 * workspace, over a field they had not touched. Harmless input does not get
 * rejected; it simply does nothing.
 */
export const createServiceSchema = z
  .object({
    ...serviceFields,
    basePriceCents: centsSchema.default(0),
    minimumPriceCents: centsSchema.default(0),
    unitPriceCents: centsSchema.default(0),
    unitSizeSqFt: serviceFields.unitSizeSqFt.default(1000),
    estimatedMinutes: serviceFields.estimatedMinutes.default(30),
    materialCostCents: centsSchema.default(0),
    equipmentCostCents: centsSchema.default(0),
    taxable: z.boolean().default(false),
    active: z.boolean().default(true),
    templateKey: singleLineText(60).optional().transform((value) => (value ? value : null)),
  });

export const updateServiceSchema = z
  .object(serviceFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

/** Drag-to-reorder in the service picker. */
export const reorderServicesSchema = z.object({
  ids: z.array(idSchema).min(1, 'Send at least one service.').max(200),
});

export const createPricingRuleSchema = z
  .object({
    name: singleLineText(120, 'That rule name is too long.').pipe(
      z.string().min(2, 'Give the rule a name.'),
    ),
    kind: z.enum(PricingRuleKind),
    /**
     * Cents for the cash kinds, basis points for the proportional ones. The
     * bound is wide because a seasonal multiplier is expressed as a
     * percentage *of par* — 11000 is 110% — and a per-mile rate is small.
     */
    amount: z
      .number()
      .int('Use a whole number.')
      .min(0, 'That cannot be negative.')
      .max(1_000_000, 'That value is implausibly large.'),
    /** Applies only when the driving quantity falls in this range. */
    minValue: z.number().int().min(0).max(10_000_000).nullable().optional(),
    maxValue: z.number().int().min(0).max(10_000_000).nullable().optional(),
    /** Null attaches the rule to every service. */
    serviceId: idSchema.nullable().optional(),
    active: z.boolean().default(true),
  })
  .refine(
    (value) =>
      value.minValue === null ||
      value.minValue === undefined ||
      value.maxValue === null ||
      value.maxValue === undefined ||
      value.minValue <= value.maxValue,
    {
      // An inverted range matches nothing, so the rule would never fire and the
      // owner would be left wondering why their surcharge does not appear.
      message: 'The lower bound has to be below the upper bound.',
      path: ['maxValue'],
    },
  )
  .refine(
    (value) =>
      value.kind !== PricingRuleKind.SEASONAL_MULTIPLIER || value.amount >= 10_000,
    {
      // A multiplier below par would be a discount wearing a surcharge's name.
      // Use a negative-priced discount line on the quote for that instead.
      message: 'A seasonal multiplier of less than 100% (10000) would reduce the price.',
      path: ['amount'],
    },
  );

export const updatePricingRuleSchema = z
  .object({
    name: singleLineText(120).pipe(z.string().min(2, 'Give the rule a name.')),
    amount: z.number().int().min(0).max(1_000_000),
    minValue: z.number().int().min(0).max(10_000_000).nullable(),
    maxValue: z.number().int().min(0).max(10_000_000).nullable(),
    active: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

/** The workspace pricing defaults every quote starts from. */
export const updatePricingDefaultsSchema = z
  .object({
    defaultLaborRateCents: centsSchema,
    defaultProfitMarginBps: bpsSchema,
    defaultTravelFeeCents: centsSchema,
    defaultMinimumJobCents: centsSchema,
    defaultOverheadCents: centsSchema,
    /** Sales tax. Bounded well above any real rate, but not unbounded. */
    defaultTaxRateBps: z
      .number()
      .int('Use basis points — 825 for 8.25%.')
      .min(0, 'That cannot be negative.')
      .max(3000, 'A tax rate above 30% is almost certainly a typo.'),

    /*
     * What the driving costs, which is a different question from what travel is
     * charged at. `defaultTravelFeeCents` is on the invoice; these two are what
     * leaves the bank account, and the gap between them is where a long drive
     * quietly eats a job.
     *
     * Nullable, because "not set" has to stay distinguishable from "free": a
     * blank fuel price leaves fuel out of a job's cost and says so, while a zero
     * would claim the truck runs on nothing.
     */
    fuelPricePerGallonCents: centsSchema.nullable(),
    /** Thousandths of a mile per gallon: 18500 is 18.5. */
    vehicleMpgMilli: z
      .number()
      .int('Use up to one decimal place.')
      .min(1_000, 'A truck that does less than 1 mpg is a typo.')
      .max(150_000, 'A truck that does more than 150 mpg is a typo.')
      .nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

/** Inputs to the standalone calculator. Nothing here is persisted. */
export const calculateQuoteSchema = z.object({
  serviceId: idSchema.optional(),
  areaSqFt: z.number().int().min(0).max(10_000_000).optional(),
  laborMinutes: z.number().int().min(0).max(60 * 24 * 5).optional(),
  laborRateCents: centsSchema.optional(),
  materialCostCents: centsSchema.optional(),
  equipmentCostCents: centsSchema.optional(),
  travelMiles: z.number().int().min(0).max(500).optional(),
  travelFeeCents: centsSchema.optional(),
  travelPerMileCents: centsSchema.optional(),
  overheadCents: centsSchema.optional(),
  profitMarginBps: bpsSchema.optional(),
  minimumJobCents: centsSchema.optional(),
  additionalFeesCents: centsSchema.optional(),
  discountCents: centsSchema.optional(),
  taxRateBps: z.number().int().min(0).max(3000).optional(),
  taxable: z.boolean().optional(),
  overridePriceCents: centsSchema.nullable().optional(),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type CalculateQuoteInput = z.infer<typeof calculateQuoteSchema>;
