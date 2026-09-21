import { Role } from '@prisma/client';
import { z } from 'zod';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { forgetPosition, recordPosition } from '@/lib/crew/repository';
import { isPlausiblePoint } from '@/lib/geo/distance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sending, and withdrawing, a live position.
 *
 * The user is the session's user and never a field in the body — the same rule
 * as the clock. A `userId` a client could set would be a way to put a colleague
 * on the map somewhere they are not.
 *
 * DELETE is not an afterthought. It is how somebody stops sharing without
 * stopping work, and a feature like this needs that to be one tap and always
 * available, or "you can turn it off" is not really true.
 */
const bodySchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMetres: z.number().min(0).max(100_000).transform(Math.round).optional(),
    /** Milliseconds since the epoch, as the browser reports it. */
    recordedAt: z.number().int().positive().optional(),
  })
  .refine(isPlausiblePoint, {
    message: 'That is not a location on earth.',
    path: ['latitude'],
  });

export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.STAFF);

  /*
   * The read limit, not the write one. A phone sends a position every couple of
   * minutes while its owner works, which is a different shape of traffic from
   * somebody creating quotes, and holding it to the write budget would cut off
   * the crew halfway through an afternoon.
   */
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { recordedAt, ...position } = parsed.data;

  const result = await recordPosition(auth.db, auth.organization.id, auth.user.id, {
    ...position,
    ...(recordedAt ? { recordedAt: new Date(recordedAt) } : {}),
  });

  return jsonOk({ recordedAt: result.recordedAt, jobId: result.jobId });
});

export const DELETE = withRoute(async () => {
  const auth = await requireRole(Role.STAFF);

  await forgetPosition(auth.db, auth.user.id);

  return jsonOk({ sharing: false });
});
