import { notFound } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { sendQuote } from '@/lib/quotes/repository';
import { getPublicConfig } from '@/lib/env';
import { idSchema } from '@/lib/validation/common';
import { DEFAULT_QUOTE_VALID_DAYS } from '@/lib/validation/quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Marks a quote sent and returns its public link.
 *
 * Delivery itself — email and SMS — arrives with the messaging phase. Until
 * then this is honest about what it does: it opens the quote for a response and
 * hands the owner a link to send however they like. That is not a stub; a link
 * an owner texts themselves is a working quote today.
 */
export const POST = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That quote does not exist.');

  const quote = await sendQuote(
    auth.db,
    auth.organization.id,
    parsed.data,
    DEFAULT_QUOTE_VALID_DAYS,
    auth.user.id,
  );

  const base = getPublicConfig().appUrl.replace(/\/+$/, '');

  return jsonOk({ quote, publicUrl: `${base}/quote/${quote.publicId}` });
});
