import { Role } from '@prisma/client';
import { z } from 'zod';

import { conflict, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import { createReviewRequest, listReviewRequests, reviewStats } from '@/lib/reviews/repository';
import { idSchema } from '@/lib/validation/common';
import { listReviewRequestsQuerySchema } from '@/lib/validation/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const parsed = listReviewRequestsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const [requests, stats] = await Promise.all([
    listReviewRequests(auth.db, parsed.data),
    reviewStats(auth.db),
  ]);

  return jsonOk({ requests, stats });
});

const askSchema = z.object({
  customerId: idSchema,
  jobId: idSchema.optional(),
});

/**
 * Asking one customer for a review, by hand.
 *
 * Rate limited as messaging rather than as a generic write: each accepted request
 * turns into a text, which costs money and lands on a real phone.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.STAFF);
  enforceRateLimit(RATE_LIMITS.messaging, auth.organization.id);

  const parsed = askSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const result = await createReviewRequest(auth.db, auth.organization.id, parsed.data);

  // The reasons it can refuse are all things the owner can fix, so they are said
  // out loud rather than returned as a silent no-op.
  if (!result.ok) throw conflict(result.message);

  return jsonOk({ reviewRequestId: result.reviewRequestId }, { status: 201 });
});
