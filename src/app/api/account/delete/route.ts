import { conflict, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { deleteOwnAccount } from '@/lib/account/delete';
import { requireAuth } from '@/lib/auth/context';
import { verifyPassword } from '@/lib/auth/password';
import { clearSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { deleteAccountSchema } from '@/lib/validation/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deletes the signed-in person's own account.
 *
 * Any member may call this, which is the point: before it existed, a crew
 * member who wanted to leave had to email and ask, and App Store Review
 * Guideline 5.1.1(v) requires that anyone who can create an account can delete
 * it from inside the app.
 *
 * Same confirmation shape as deleting a workspace — the password re-entered,
 * plus a word typed out — and the same rate limit, because a wrong password
 * here is a password guess against a signed-in account.
 *
 * A POST rather than a DELETE for the same reason as the workspace route: some
 * proxies drop a DELETE's body, and the body is the confirmation.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.login, `account-delete:${auth.user.id}`);

  if (auth.organization.isDemo) {
    throw conflict('This is a demo account. It deletes itself automatically, so there is nothing to do.');
  }

  const parsed = deleteAccountSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const person = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(parsed.data.password, person.passwordHash))) {
    throw validationFailed({ password: 'That password is not right.' });
  }

  // Throws a conflict naming the workspace when this person is its only owner.
  // Deleting them would leave a business with customers and a subscription and
  // nobody who can administer it.
  await deleteOwnAccount(auth.user.id);

  await clearSessionCookie();

  return jsonOk({ deleted: true });
});
