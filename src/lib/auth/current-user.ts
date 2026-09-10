import { unauthorized } from '@/lib/api/errors';
import { getSession, type SessionPayload } from '@/lib/auth/session';
import { prisma } from '@/lib/db';

/**
 * Resolves the signed-in user for a route handler, or throws 401.
 *
 * The JWT is self-contained, but the user row is still read back so that a
 * deleted account cannot keep acting on a token that has not expired yet.
 */
export type CurrentUser = {
  id: string;
  email: string;
  studioName: string | null;
  storeReceiptImages: boolean;
};

export async function requireUser(): Promise<CurrentUser> {
  const session: SessionPayload | null = await getSession();
  if (!session) throw unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, studioName: true, storeReceiptImages: true },
  });

  if (!user) throw unauthorized('Your session is no longer valid. Please sign in again.');

  return user;
}

/** Non-throwing variant for pages that render differently when signed out. */
export async function getCurrentUser() {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}
