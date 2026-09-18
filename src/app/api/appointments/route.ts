import { Role } from '@prisma/client';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import { instantToWallClock } from '@/lib/dates';
import { createAppointment, loadCalendar } from '@/lib/scheduling/repository';
import { calendarQuerySchema, createAppointmentSchema } from '@/lib/validation/scheduling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The calendar for a day or a week, in the business's own timezone. */
export const GET = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const parsed = calendarQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const timeZone = auth.organization.timezone;
  const wall = instantToWallClock(new Date(), timeZone);
  const today = [
    String(wall.year).padStart(4, '0'),
    String(wall.month).padStart(2, '0'),
    String(wall.day).padStart(2, '0'),
  ].join('-');

  const calendar = await loadCalendar(auth.db, timeZone, {
    anchorDate: parsed.data.date ?? today,
    view: parsed.data.view,
  });

  return jsonOk({ calendar });
});

export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.STAFF);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = createAppointmentSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const appointment = await createAppointment(
    auth.db,
    auth.organization.id,
    auth.organization.timezone,
    parsed.data,
  );

  return jsonOk({ appointment }, { status: 201 });
});
