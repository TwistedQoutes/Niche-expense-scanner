import { Role } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { scheduleJob } from '@/lib/jobs/repository';
import { idSchema } from '@/lib/validation/common';
import { scheduleJobSchema } from '@/lib/validation/scheduling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Booking a job onto the calendar.
 *
 * The date and time are the *business's* wall clock, converted server-side using
 * its configured timezone — so a browser set to another zone cannot move a
 * booking by an hour.
 */
export const POST = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.STAFF);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) throw notFound('That job does not exist.');

  const parsed = scheduleJobSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const job = await scheduleJob(
    auth.db,
    auth.organization.id,
    auth.organization.timezone,
    parsedId.data,
    parsed.data,
  );

  return jsonOk({ job });
});
