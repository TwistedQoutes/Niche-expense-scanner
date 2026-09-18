import { Role } from '@prisma/client';

import { notFound } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { revokeInvitation } from '@/lib/team/repository';
import { idSchema } from '@/lib/validation/common';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Withdraws an invitation.
 *
 * The first thing anyone needs after inviting the wrong address. Revoked rather
 * than deleted, so the row remains as a record that somebody was asked and then
 * un-asked — and so the link, which is already in an inbox, stops working.
 */
export const DELETE = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That invitation does not exist.');

  await revokeInvitation(auth.db, parsed.data);

  return jsonOk({ ok: true });
});
