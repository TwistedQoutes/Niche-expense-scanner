import { Role } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { cancelAppointment, updateAppointment } from '@/lib/scheduling/repository';
import { idSchema } from '@/lib/validation/common';
import { updateAppointmentSchema } from '@/lib/validation/scheduling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That appointment does not exist.');
  return parsed.data;
}

/** Rescheduling, renaming, or marking a visit confirmed or missed. */
export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.STAFF);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = updateAppointmentSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const appointment = await updateAppointment(
    auth.db,
    auth.organization.timezone,
    await readId(context.params),
    parsed.data,
  );

  return jsonOk({ appointment });
});

/**
 * Cancelling a visit.
 *
 * The row is kept and marked CANCELLED rather than deleted: the slot has to go
 * back on the calendar, but "there was a visit here and it was called off" is
 * information an owner needs when a customer asks why nobody came.
 */
export const DELETE = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.STAFF);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  await cancelAppointment(auth.db, await readId(context.params));

  return jsonOk({ ok: true });
});
