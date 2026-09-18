import { Role } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { effectivePlan } from '@/lib/billing/usage';
import { changeMemberRole, restoreMember, suspendMember } from '@/lib/team/repository';
import { idSchema } from '@/lib/validation/common';
import { updateMemberSchema } from '@/lib/validation/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Changing and revoking a teammate's access.
 *
 * Every one of these is guarded by rank inside the repository rather than here:
 * the actor must strictly outrank the person they are acting on, and may never
 * act on themselves. The route's job is only to say who may reach it at all.
 *
 * `[id]` is a **user** id, not a membership id. A membership is identified by the
 * pair (user, organization) and the organization is already fixed by the session,
 * so the user id is the whole of the remaining question — and it is what the
 * screen already has in hand.
 */
async function readUserId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That teammate does not exist.');
  return parsed.data;
}

export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const userId = await readUserId(context.params);

  const body = (await readJsonBody(request)) as Record<string, unknown>;

  // One route, two verbs, because "put them back to work" is the same decision as
  // "change what they can do" from the screen's point of view.
  if (body.status === 'ACTIVE') {
    await restoreMember(
      auth.db,
      { userId: auth.user.id, role: auth.role },
      effectivePlan(auth.subscription),
      userId,
    );
    return jsonOk({ ok: true });
  }

  const parsed = updateMemberSchema.safeParse(body);
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  await changeMemberRole(auth.db, { userId: auth.user.id, role: auth.role }, userId, parsed.data.role);

  return jsonOk({ ok: true });
});

/**
 * Suspends access. Takes effect on their next request, not on their next login:
 * `requireAuth` re-reads the membership every time and refuses anything but
 * ACTIVE, so a signed-in session stops working immediately.
 */
export const DELETE = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  await suspendMember(auth.db, { userId: auth.user.id, role: auth.role }, await readUserId(context.params));

  return jsonOk({ ok: true });
});
