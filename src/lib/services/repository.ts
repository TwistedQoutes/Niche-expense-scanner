import { Prisma } from '@prisma/client';

/** Everything the catalogue editor and the calculator need from a service. */
export const SERVICE_SELECT = {
  id: true,
  name: true,
  description: true,
  templateKey: true,
  basePriceCents: true,
  minimumPriceCents: true,
  unitPriceCents: true,
  unitSizeSqFt: true,
  estimatedMinutes: true,
  laborRateCents: true,
  materialCostCents: true,
  equipmentCostCents: true,
  taxable: true,
  active: true,
  position: true,
} satisfies Prisma.ServiceSelect;

export type ServiceRecord = Prisma.ServiceGetPayload<{ select: typeof SERVICE_SELECT }>;

/** Everything the rules editor needs. */
export const PRICING_RULE_SELECT = {
  id: true,
  serviceId: true,
  name: true,
  kind: true,
  amount: true,
  minValue: true,
  maxValue: true,
  active: true,
  position: true,
} satisfies Prisma.PricingRuleSelect;

export type PricingRuleRecord = Prisma.PricingRuleGetPayload<{
  select: typeof PRICING_RULE_SELECT;
}>;
