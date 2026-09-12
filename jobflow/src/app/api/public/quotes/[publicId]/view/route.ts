import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { resolvePublicQuote } from '@/lib/quotes/public';
import { recordQuoteView } from '@/lib/quotes/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Records that the customer opened their quote.
 *
 * Called from the page after it mounts rather than during its render. Writing to
 * the database while rendering is a side effect in a place React is free to run
 * twice, and it would also count a link-preview fetch or a prefetch as a human
 * opening the quote — which is precisely the signal an owner is relying on when
 * they see "viewed".
 *
 * Unauthenticated by necessity, so rate-limited by IP.
 */
export const POST = withRoute(async (request, context: { params: Promise<{ publicId: string }> }) => {
  enforceRateLimit(RATE_LIMITS.publicQuote, clientIp(request));

  const { publicId } = await context.params;
  const scope = await resolvePublicQuote(publicId);

  await recordQuoteView(scope.db, publicId);

  return jsonOk({ ok: true });
});
