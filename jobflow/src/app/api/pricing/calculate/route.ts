import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { resolvePricing } from '@/lib/pricing/resolve';
import { calculateQuoteSchema } from '@/lib/validation/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Prices a job without saving anything.
 *
 * Shares `resolvePricing` with quote creation, so the number shown in the
 * calculator is by construction the number that lands on the quote.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const parsed = calculateQuoteSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { breakdown, input } = await resolvePricing(auth, parsed.data);

  return jsonOk({ breakdown, input });
});
