import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { calculatePricing, inputsFromService, type PricingInput } from '@/lib/pricing/engine';
import { calculateQuoteSchema } from '@/lib/validation/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Prices a job without saving anything.
 *
 * The engine is pure and could run in the browser, which would make the
 * calculator instant. It runs here instead, deliberately: the labour rates,
 * margins and pricing rules a business quotes on are the most commercially
 * sensitive numbers it has, and shipping them all to the client so a form can
 * do arithmetic hands them to anyone who opens the network tab — including a
 * competitor who signs up for a free account.
 *
 * The client sends what the owner typed; the server supplies the rates.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const parsed = calculateQuoteSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { serviceId, ...overrides } = parsed.data;

  // Organization is the tenant, not a row inside one, so it is read through the
  // unscoped client using the id from the verified session.
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

  if (serviceId) {
    const service = await auth.db.service.findUnique({
      where: { id: serviceId },
      select: {
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

    input = inputsFromService(service, organization, overrides);
  } else {
    // No service chosen: price from the workspace defaults plus whatever the
    // owner typed. This is the "what would I charge for two hours?" case.
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

  // Rules attached to this service, plus the workspace-wide ones (serviceId
  // null). An inactive rule is excluded here rather than inside the engine, so
  // the engine stays a pure function of what it is handed.
  const rules = await auth.db.pricingRule.findMany({
    where: {
      active: true,
      OR: [{ serviceId: serviceId ?? null }, { serviceId: null }],
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, kind: true, amount: true, minValue: true, maxValue: true },
  });

  const breakdown = calculatePricing({ ...input, rules });

  return jsonOk({ breakdown, input });
});
