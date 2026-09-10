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
  emailVerifiedAt: Date | null;
  sessionVersion: number;
  stripeCustomerId: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
};

export async function requireUser(): Promise<CurrentUser> {
  const session: SessionPayload | null = await getSession();
  if (!session) throw unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      studioName: true,
      storeReceiptImages: true,
      emailVerifiedAt: true,
      sessionVersion: true,
      stripeCustomerId: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
    },
  });

  if (!user) throw unauthorized('Your session is no longer valid. Please sign in again.');

  // The revocation check. A password change or "sign out everywhere" bumps the
  // stored version, and every token issued before that stops working here.
  if (user.sessionVersion !== session.sessionVersion) {
    throw unauthorized('Your session has ended. Please sign in again.');
  }

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
