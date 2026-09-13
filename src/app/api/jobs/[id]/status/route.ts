import { Role } from '@prisma/client';
import { z } from 'zod';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { cancelJob, completeJob, startJob } from '@/lib/jobs/repository';
import { idSchema } from '@/lib/validation/common';
import { cancelJobSchema, completeJobSchema } from '@/lib/validation/scheduling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Moving a job through its life.
 *
 * One endpoint rather than three, because the actions are mutually exclusive and
 * the legal transitions are defined in one place (`canTransition`). The action is
 * named in the body so a crew member's tap cannot be replayed from a URL in a
 * browser history.
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  // `.extend` rather than `.and`: an intersection is not a discriminable object,
  // so the union would stop narrowing and every branch would come out `unknown`.
  completeJobSchema.extend({ action: z.literal('complete') }),
  cancelJobSchema.extend({ action: z.literal('cancel') }),
]);

export const POST = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.STAFF);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) throw notFound('That job does not exist.');

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const body = parsed.data;

  if (body.action === 'start') {
    return jsonOk({ job: await startJob(auth.db, parsedId.data) });
  }

  if (body.action === 'complete') {
    const { job, changed } = await completeJob(auth.db, auth.organization.id, parsedId.data, body);

    // `changed: false` means it was already complete. Reported rather than
    // hidden, so the UI can stay quiet instead of claiming it just happened.
    return jsonOk({ job, changed });
  }

  return jsonOk({ job: await cancelJob(auth.db, parsedId.data, body.reason) });
});
