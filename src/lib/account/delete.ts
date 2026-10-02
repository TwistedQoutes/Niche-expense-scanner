import { MembershipStatus, Role } from '@prisma/client';

import { AppError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';

/**
 * Deleting your own sign-in account.
 *
 * Distinct from deleting a workspace (`src/lib/workspace/delete.ts`), which is
 * an owner destroying a business's records. This is one person leaving: their
 * account goes, and the work they did stays, because a quote they wrote is the
 * business's record of what a customer was charged and not theirs to take.
 *
 * It exists because App Store Review Guideline 5.1.1(v) requires that an app
 * which lets someone create an account also lets them delete it from inside the
 * app. Before this, only an owner could delete anything, and a crew member had
 * no way out but an email — which is a rejection.
 *
 * The one case it refuses is the sole owner of a workspace. Letting them go
 * would leave a business with customers, a subscription and nobody who can
 * administer it, so they are told to delete the workspace instead. That path is
 * in the same settings screen, so the guideline is still satisfied: the account
 * can be deleted from inside the app, it just takes the workspace with it.
 */

export type AccountDeletionResult = {
  /** Workspaces this person stopped being a member of. */
  membershipsRemoved: number;
};

/**
 * Workspaces where this person is the only owner left.
 *
 * Suspended and invited owners do not count toward "someone else can run it":
 * an invitation nobody accepted is not an administrator.
 */
export async function soleOwnerOf(
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const owned = await prisma.membership.findMany({
    where: { userId, role: Role.OWNER, status: MembershipStatus.ACTIVE },
    select: { organization: { select: { id: true, name: true } } },
  });

  if (owned.length === 0) return [];

  const counts = await prisma.membership.groupBy({
    by: ['organizationId'],
    where: {
      organizationId: { in: owned.map((membership) => membership.organization.id) },
      role: Role.OWNER,
      status: MembershipStatus.ACTIVE,
    },
    _count: { _all: true },
  });

  const alone = new Set(
    counts.filter((row) => row._count._all <= 1).map((row) => row.organizationId),
  );

  return owned
    .map((membership) => membership.organization)
    .filter((organization) => alone.has(organization.id));
}

/**
 * Removes the person, and leaves the business's records alone.
 *
 * One transaction. Memberships go first so that a request arriving mid-delete
 * fails the membership check rather than finding a user row that is about to
 * disappear; device tokens go with them, or a deleted colleague's phone would
 * keep buzzing with a workspace's customer names on the lock screen.
 *
 * Rows that record work — jobs assigned, time entries, quotes authored — keep
 * their foreign keys or null them per the schema. That is deliberate: the
 * business still needs to know a job was done and who clocked the hours for
 * payroll, and erasing that on request would destroy another party's records.
 */
export async function deleteOwnAccount(userId: string): Promise<AccountDeletionResult> {
  const blocking = await soleOwnerOf(userId);

  if (blocking.length > 0) {
    const names = blocking.map((organization) => organization.name).join(', ');
    throw new AppError(
      'conflict',
      blocking.length === 1
        ? `You are the only owner of ${names}. Delete the workspace, or make someone else an owner first, then delete your account.`
        : `You are the only owner of these workspaces: ${names}. Hand each one over or delete it, then delete your account.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const memberships = await tx.membership.deleteMany({ where: { userId } });
    await tx.deviceToken.deleteMany({ where: { userId } });
    // Password-reset and verification tokens, which would otherwise outlive the
    // account they let into.
    await tx.authToken.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });

    return { membershipsRemoved: memberships.count };
  });
}
