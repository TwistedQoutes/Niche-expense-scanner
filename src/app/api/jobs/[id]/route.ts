import { Role } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import { getJob, updateJob } from '@/lib/jobs/repository';
import { idSchema } from '@/lib/validation/common';
import { updateJobSchema } from '@/lib/validation/scheduling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That job does not exist.');
  return parsed.data;
}

export const GET = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const job = await getJob(auth.db, await readId(context.params));

  return jsonOk({ job });
});

export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.STAFF);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = updateJobSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const job = await updateJob(auth.db, await readId(context.params), parsed.data);

  return jsonOk({ job });
});
