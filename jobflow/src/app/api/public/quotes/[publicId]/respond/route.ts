import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { resolvePublicQuote } from '@/lib/quotes/public';
import { respondToQuote } from '@/lib/quotes/repository';
import { respondToQuoteSchema } from '@/lib/validation/quotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Accept, decline, or ask for changes.
 *
 * The single most consequential endpoint in the product, and the only one that
 * writes without a session — a customer must be able to accept a quote without
 * creating an account, so the unguessable link is the credential.
 *
 * Accepting creates a job, notifies the business and advances the lead. It is
 * idempotent: a double-tap on a phone returns the first outcome rather than
 * producing a second job.
 */
export const POST = withRoute(
  async (request, context: { params: Promise<{ publicId: string }> }) => {
    enforceRateLimit(RATE_LIMITS.publicQuoteAction, clientIp(request));

    const { publicId } = await context.params;

    const parsed = respondToQuoteSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

    const scope = await resolvePublicQuote(publicId);

    const result = await respondToQuote(
      scope.db,
      scope.organizationId,
      publicId,
      parsed.data.action,
      parsed.data.note,
    );

    // The job id is returned but deliberately not linked anywhere on the public
    // page: it is internal, and a customer has no business fetching it.
    return jsonOk({ status: result.status, jobNumber: result.jobNumber });
  },
);
