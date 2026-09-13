import { Role } from '@prisma/client';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import { createJob, listJobs } from '@/lib/jobs/repository';
import { createJobSchema, jobStatusQuerySchema } from '@/lib/validation/scheduling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const parsed = jobStatusQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { jobs, nextCursor } = await listJobs(auth.db, parsed.data);

  return jsonOk({ jobs, nextCursor });
});

/**
 * A job with no quote behind it.
 *
 * The usual path is a customer accepting a quote, which creates the job itself.
 * This is for the regular who rings up and asks for the same as last time —
 * making them sit through a quote they have already agreed to would be theatre.
 *
 * MEMBER and up: a job carries a price, so it is money.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.STAFF);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = createJobSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const job = await createJob(auth.db, auth.organization.id, parsed.data);

  return jsonOk({ job }, { status: 201 });
});
