import { Prisma, UsageMetric } from '@prisma/client';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { effectivePlan, enforceUsageLimit, recordUsage } from '@/lib/billing/usage';
import { destinationFor } from '@/lib/maps/drive';
import { resolvePricing } from '@/lib/pricing/resolve';
import { QUOTE_ROW_SELECT, createQuote } from '@/lib/quotes/repository';
import { createQuoteSchema, listQuotesQuerySchema } from '@/lib/validation/quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const parsed = listQuotesQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { status, customerId, search, cursor, limit } = parsed.data;
  const where: Prisma.QuoteWhereInput = {};

  if (status) where.status = status;
  if (customerId) where.customerId = customerId;
  if (search) {
    where.OR = [
      { number: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
      { customer: { firstName: { contains: search, mode: 'insensitive' } } },
      { customer: { lastName: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const rows = await auth.db.quote.findMany({
    where,
    select: QUOTE_ROW_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const quotes = hasMore ? rows.slice(0, limit) : rows;

  return jsonOk({ quotes, nextCursor: hasMore ? (quotes.at(-1)?.id ?? null) : null });
});

export const POST = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = createQuoteSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const plan = effectivePlan(auth.subscription);
  await enforceUsageLimit(auth.db, plan, UsageMetric.QUOTES);

  const body = parsed.data;

  // A quote has to be *for* somebody. Guarded explicitly rather than left to a
  // foreign-key error, so the message names the problem.
  if (!body.customerId && !body.leadId) {
    throw validationFailed({ customerId: 'Attach the quote to a customer or a lead.' });
  }

  // Which ids are real, and whose they are, is settled inside `createQuote` —
  // one check next to the write rather than a copy here that a second caller
  // would not inherit. See src/lib/db/ownership.ts.

  /*
   * The drive, measured from the business's own address to wherever this quote
   * is going, and folded into the travel line before anything is priced.
   *
   * This is the difference between a travel charge that reflects the job and one
   * that reflects whatever the default happened to be. It costs one Google
   * request per property, ever — the answer is cached on the property — and when
   * it cannot be worked out the quote prices exactly as it did before.
   */
  const destination = await destinationFor(auth.db, {
    propertyId: body.propertyId ?? null,
    customerId: body.customerId ?? null,
    leadId: body.leadId ?? null,
  });

  const { breakdown, input, serviceName } = await resolvePricing(auth, body.pricing, {
    destination,
  });

  const quote = await createQuote(auth.db, {
    organizationId: auth.organization.id,
    customerId: body.customerId ?? null,
    leadId: body.leadId ?? null,
    propertyId: body.propertyId ?? null,
    title: body.title ?? serviceName ?? null,
    summary: body.summary ?? null,
    terms: body.terms ?? null,
    validForDays: body.validForDays,
    currency: auth.organization.currency,
    breakdown,
    pricingInput: input as unknown as Record<string, unknown>,
    items: body.items,
    // Carried through so the accepted job knows which service it was, which is
    // what makes the services report able to attribute revenue at all.
    serviceId: body.pricing.serviceId ?? null,
    serviceName,
    actorUserId: auth.user.id,
  });

  // Recorded after the write succeeds, so a rejected quote does not spend
  // someone's monthly allowance.
  await recordUsage(auth.db, auth.organization.id, UsageMetric.QUOTES);

  return jsonOk({ quote, breakdown }, { status: 201 });
});
