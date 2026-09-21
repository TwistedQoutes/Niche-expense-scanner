import { Role } from '@prisma/client';
import { z } from 'zod';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { clockIn, clockOut } from '@/lib/time/repository';
import { idSchema } from '@/lib/validation/common';
import { clockInSchema, clockOutSchema } from '@/lib/validation/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * On the clock, off the clock.
 *
 * STAFF, not ADMIN: the crew are the whole point, and a timesheet only a manager
 * can fill in is a timesheet filled in from memory at the end of the week.
 *
 * The user is taken from the session and never from the body. That is the one
 * thing this endpoint must not get wrong — a `userId` a client could set is a
 * form for clocking in a colleague who is still in bed, and the wage bill would
 * quietly agree.
 */
const bodySchema = z.discriminatedUnion('action', [
  clockInSchema.safeExtend({ action: z.literal('in') }),
  clockOutSchema.safeExtend({ action: z.literal('out') }),
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

  if (body.action === 'in') {
    const result = await clockIn(
      auth.db,
      auth.organization.id,
      parsedId.data,
      auth.user.id,
      body,
    );

    // `changed: false` means they were already on the clock here, so the UI can
    // stay quiet rather than announce a start that did not happen.
    return jsonOk({
      entry: result.entry,
      changed: result.changed,
      proximity: result.proximity,
    });
  }

  const result = await clockOut(auth.db, parsedId.data, auth.user.id, body);

  return jsonOk({
    entry: result.entry,
    minutes: result.minutes,
    changed: result.changed,
    proximity: result.proximity,
  });
});
