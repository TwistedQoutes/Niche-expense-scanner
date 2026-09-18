import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { clearSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';

export const runtime = 'nodejs';

/**
 * Revokes every session this user has, on every device.
 *
 * Bumping `sessionVersion` is what makes a stateless JWT revocable: each
 * request compares the version in the token against the one in the database
 * (see requireAuth), and every token minted before this increment stops
 * matching.
 */
export const POST = withRoute(async () => {
  const { user } = await requireAuth();

  await prisma.user.update({
    where: { id: user.id },
    data: { sessionVersion: { increment: 1 } },
  });

  await clearSessionCookie();

  return jsonOk({ ok: true, message: 'Signed out on every device.' });
});
