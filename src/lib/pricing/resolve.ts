import { notFound } from '@/lib/api/errors';
import type { AuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { calculatePricing, inputsFromService, type PricingBreakdown, type PricingInput } from '@/lib/pricing/engine';
import type { CalculateQuoteInput } from '@/lib/validation/services';

/**
 * Turns validated calculator inputs into a priced breakdown.
 *
 * Shared by `/api/pricing/calculate` and quote creation so the two cannot drift:
 * the number the owner sees in the calculator has to be the number that lands on
 * the quote, and the surest way to guarantee that is one code path.
 *
 * The client never supplies rates, margins or rules. It sends quantities — an
 * area, a number of minutes, a discount — and the server looks up what those
 * cost. A total posted from a browser is a total anyone can choose.
 */
export async function resolvePricing(
  auth: AuthContext,
  request: CalculateQuoteInput,
): Promise<{ breakdown: PricingBreakdown; input: PricingInput; serviceName: string | null }> {
  const { serviceId, ...overrides } = request;

  // Organization is the tenant rather than a row inside one, so it is read
  // through the unscoped client using the id from the verified session.
  const organization = await prisma.organization.findUnique({
    where: { id: auth.organization.id },
    select: {
      defaultLaborRateCents: true,
      defaultProfitMarginBps: true,
      defaultTravelFeeCents: true,
      defaultMinimumJobCents: true,
      defaultOverheadCents: true,
      defaultTaxRateBps: true,
    },
  });

  if (!organization) throw notFound('That workspace no longer exists.');

  let input: PricingInput;
  let serviceName: string | null = null;

  if (serviceId) {
    const service = await auth.db.service.findUnique({
      where: { id: serviceId },
      select: {
        name: true,
        basePriceCents: true,
        minimumPriceCents: true,
        unitPriceCents: true,
        unitSizeSqFt: true,
        estimatedMinutes: true,
        laborRateCents: true,
        materialCostCents: true,
        equipmentCostCents: true,
        taxable: true,
      },
    });

    if (!service) throw notFound('That service does not exist.');

    serviceName = service.name;
    input = inputsFromService(service, organization, overrides);
  } else {
    input = {
      laborRateCents: organization.defaultLaborRateCents,
      profitMarginBps: organization.defaultProfitMarginBps,
      travelFeeCents: organization.defaultTravelFeeCents,
      minimumJobCents: organization.defaultMinimumJobCents,
      overheadCents: organization.defaultOverheadCents,
      taxRateBps: organization.defaultTaxRateBps,
      taxable: true,
      ...overrides,
    };
  }

  // An inactive rule is filtered out here rather than inside the engine, so the
  // engine stays a pure function of exactly what it is handed.
  const rules = await auth.db.pricingRule.findMany({
    where: {
      active: true,
      OR: [{ serviceId: serviceId ?? null }, { serviceId: null }],
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, kind: true, amount: true, minValue: true, maxValue: true },
  });

  const withRules: PricingInput = { ...input, rules };

  return { breakdown: calculatePricing(withRules), input: withRules, serviceName };
}
