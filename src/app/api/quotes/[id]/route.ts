import { QuoteStatus } from '@prisma/client';

import { conflict, notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { resolvePricing } from '@/lib/pricing/resolve';
import { QUOTE_ROW_SELECT, effectiveStatus, getQuoteByIdOrPublicId } from '@/lib/quotes/repository';
import { idSchema } from '@/lib/validation/common';
import { updateQuoteSchema } from '@/lib/validation/quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That quote does not exist.');
  return parsed.data;
}

export const GET = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const quote = await getQuoteByIdOrPublicId(auth.db, { id: await readId(context.params) });

  return jsonOk({ quote, status: effectiveStatus(quote) });
});

/**
 * Edits a quote, and only while it is a draft.
 *
 * Once a quote has been sent, the customer has a copy of a specific set of
 * numbers. Silently changing them underneath would mean the price they accept is
 * not the price they were shown — so a sent quote is immutable and a change
 * means a new one.
 */
export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const parsed = updateQuoteSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const existing = await auth.db.quote.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) throw notFound('That quote does not exist.');

  if (existing.status !== QuoteStatus.DRAFT) {
    throw conflict('This quote has already been sent. Create a new one to change the price.');
  }

  const { pricing, ...rest } = parsed.data;

  // Repricing rewrites the frozen figures, which is only safe on a draft.
  const repriced = pricing ? await resolvePricing(auth, pricing) : null;

  const quote = await auth.db.quote.update({
    where: { id },
    data: {
      ...rest,
      ...(repriced
        ? {
            laborCostCents: repriced.breakdown.laborCostCents,
            materialCostCents: repriced.breakdown.materialCostCents,
            equipmentCostCents: repriced.breakdown.equipmentCostCents,
            travelCostCents: repriced.breakdown.travelCostCents,
            overheadCents: repriced.breakdown.overheadCents,
            estimatedCostCents: repriced.breakdown.estimatedCostCents,
            profitMarginBps: repriced.breakdown.targetMarginBps,
            subtotalCents: repriced.breakdown.subtotalCents,
            discountCents: repriced.breakdown.discountCents,
            taxRateBps: repriced.breakdown.taxRateBps,
            taxCents: repriced.breakdown.taxCents,
            totalCents: repriced.breakdown.totalCents,
            priceOverridden: repriced.breakdown.overridden,
          }
        : {}),
    },
    select: QUOTE_ROW_SELECT,
  });

  return jsonOk({ quote });
});

export const DELETE = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const existing = await auth.db.quote.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) throw notFound('That quote does not exist.');

  // A sent quote is a record of what was offered, and an accepted one is the
  // basis of a job. Neither is ours to erase.
  if (existing.status !== QuoteStatus.DRAFT) {
    throw conflict('Only a draft can be deleted. A sent quote is part of your record.');
  }

  await auth.db.quote.deleteMany({ where: { id } });

  return jsonOk({ ok: true });
});
