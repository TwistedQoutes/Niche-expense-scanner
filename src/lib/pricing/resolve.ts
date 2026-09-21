import { notFound } from '@/lib/api/errors';
import type { AuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { driveFromBase, type DriveDestination } from '@/lib/maps/drive';
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
  options: {
    /**
     * Where the work is, when it is known.
     *
     * Given one, the drive from the business's own address is measured and used
     * as the travel distance — unless the caller supplied one, which always
     * wins. An owner who typed 12 miles meant 12 miles, and a measurement that
     * silently overrode them would make the field feel broken.
     */
    destination?: DriveDestination | null;
  } = {},
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
      // Where the truck leaves from, for the measurement below.
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
    },
  });

  if (!organization) throw notFound('That workspace no longer exists.');

  /*
   * The travel distance, measured rather than guessed.
   *
   * Only when the caller did not give one — `travelMiles` is optional, so
   * `undefined` means "nobody said" while `0` means somebody deliberately said
   * none. Conflating those would overwrite a considered zero on every recalc.
   *
   * A null answer is ordinary: no Maps key, no address on either end, or Google
   * had nothing to say. The travel line then falls back to the service or
   * workspace default exactly as it did before, and the quote is unaffected.
   */
  if (overrides.travelMiles === undefined && options.destination) {
    const drive = await driveFromBase(auth.db, organization, options.destination);
    if (drive) overrides.travelMiles = drive.miles;
  }

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
