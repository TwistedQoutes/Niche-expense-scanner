import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { clearSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Ends every session, on every device.
 *
 * Bumping `sessionVersion` invalidates all outstanding tokens at once — the
 * thing a self-contained JWT cannot otherwise do. Useful after using a shared
 * computer, or if a phone goes missing.
 */
export const POST = withRoute(async () => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.write, user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { sessionVersion: { increment: 1 } },
  });

  await clearSessionCookie();

  return jsonOk({ ok: true });
});
