import { Role } from '@prisma/client';
import { z } from 'zod';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { applyRouteOrder } from '@/lib/routing/repository';
import { idSchema } from '@/lib/validation/common';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Applying a suggested order to a day.
 *
 * ADMIN and above. Rearranging a day changes times customers have been told,
 * which is not a decision for whoever happens to be holding a phone — and the
 * crew member most affected by it is the one driving.
 */
const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the day as YYYY-MM-DD.'),
  /*
   * The order is sent whole rather than as a diff. The client has just shown the
   * owner a specific sequence and this is that sequence; reconstructing it from
   * moves would let the two drift apart in exactly the case where being wrong
   * matters.
   */
  order: z.array(idSchema).min(2, 'A route needs at least two stops.').max(60),
});

export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { date, order } = parsed.data;

  // A repeated id would pack one job into two slots and silently drop another.
  if (new Set(order).size !== order.length) {
    throw validationFailed({ order: 'That order lists the same stop twice.' });
  }

  const result = await applyRouteOrder(auth.db, auth.organization.timezone, date, order);

  return jsonOk(result);
});
