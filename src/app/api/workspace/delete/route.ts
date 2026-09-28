import { Role } from '@prisma/client';

import { conflict, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { verifyPassword } from '@/lib/auth/password';
import { clearSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { deleteWorkspace } from '@/lib/workspace/delete';
import { deleteWorkspaceSchema, namesMatch } from '@/lib/validation/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deletes the signed-in workspace, permanently.
 *
 * OWNER only, with the business name typed out and the owner's password
 * re-entered (see `deleteWorkspaceSchema` for why both). A POST with a JSON
 * body rather than a DELETE: some proxies drop a DELETE's body, and the body is
 * the confirmation.
 *
 * Limited per user, on the login limiter's numbers: a wrong password here is a
 * password guess against a signed-in account, and deserves the same brake.
 *
 * A demo is refused. Its owner is a throwaway account with a random password
 * nobody knows, and the daily sweep deletes it anyway.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.OWNER);
  enforceRateLimit(RATE_LIMITS.login, `workspace-delete:${auth.user.id}`);

  if (auth.organization.isDemo) {
    throw conflict('This is a demo workspace. It deletes itself automatically, so there is nothing to do.');
  }

  const parsed = deleteWorkspaceSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  if (!namesMatch(parsed.data.confirmName, auth.organization.name)) {
    throw validationFailed({ confirmName: `Type “${auth.organization.name}” exactly to confirm.` });
  }

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(parsed.data.password, owner.passwordHash))) {
    throw validationFailed({ password: 'That password is not right.' });
  }

  const result = await deleteWorkspace(auth.organization.id);

  // This browser's session pointed at a workspace that is gone. Other members'
  // sessions fail on their next request, when their membership is re-read.
  await clearSessionCookie();

  return jsonOk({ deleted: true, accountDeleted: result.users > 0 });
});
