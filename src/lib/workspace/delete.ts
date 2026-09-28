import { SubscriptionStatus } from '@prisma/client';

import { badGateway } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { storage } from '@/lib/storage';
import { StripeError, cancelSubscriptionNow } from '@/lib/stripe/client';

/**
 * Deleting a workspace, and everything in it.
 *
 * Irreversible, so the order of the steps is the design:
 *
 *  1. **Billing first, and it can stop everything.** If the business has a live
 *     Stripe subscription it is cancelled before a single row goes. When Stripe
 *     cannot be reached the whole deletion is refused, and nothing is touched —
 *     the owner can simply try again. The other order risks the worst outcome
 *     available here: the workspace gone, and the card still charged every
 *     month for it, with no account left to cancel from.
 *
 *  2. **One transaction for the database.** Deleting the Organization row
 *     cascades to every tenant table — customers, leads, quotes, jobs, messages,
 *     photos' rows, time entries, the audit log. In the same transaction go the
 *     sign-in accounts of the people who belonged to this workspace and to no
 *     other: an account whose only workspace is gone can do nothing but hold a
 *     name, an email address and a password hash. Someone who also works for
 *     another business keeps their account, because it is not this owner's to
 *     delete. Platform admins are never deleted by a customer's action.
 *
 *  3. **Photo files last.** The rows are already gone, so a failed delete here
 *     leaves an unreferenced object in the bucket — invisible to everyone and
 *     retried by nothing, which is why it is counted and logged rather than
 *     swallowed. The other order could leave rows pointing at missing images,
 *     or, if the transaction failed after the files went, a workspace whose
 *     photos had been destroyed while the owner was told nothing happened.
 *
 * Sessions need no separate step. Every request re-reads the membership
 * (`requireAuth`), so a teammate mid-session is signed out on their next click,
 * and a deleted account's token verifies against a user that no longer exists.
 */

export type DeletionResult = {
  users: number;
  files: number;
  filesNotRemoved: number;
  subscriptionCancelled: boolean;
};

export async function deleteWorkspace(organizationId: string): Promise<DeletionResult> {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      id: true,
      subscription: { select: { stripeSubscriptionId: true, status: true } },
      memberships: { select: { userId: true } },
      files: { select: { storageKey: true } },
    },
  });

  // ── 1. Billing ────────────────────────────────────────────────────────────
  const subscription = organization.subscription;
  let subscriptionCancelled = false;
  if (subscription?.stripeSubscriptionId && subscription.status !== SubscriptionStatus.CANCELED) {
    try {
      await cancelSubscriptionNow(subscription.stripeSubscriptionId);
      subscriptionCancelled = true;
    } catch (error) {
      // Stripe's message is for us, not the owner: it can name internal ids.
      console.error('[workspace] could not cancel the subscription; nothing was deleted', {
        organizationId,
        error: error instanceof StripeError ? error.message : error,
      });
      throw badGateway(
        'We could not cancel your subscription with our payment provider, so nothing has been deleted. Please try again in a few minutes.',
      );
    }
  }

  // ── 2. The database ───────────────────────────────────────────────────────
  const memberIds = organization.memberships.map((membership) => membership.userId);

  const users = await prisma.$transaction(async (tx) => {
    await tx.organization.delete({ where: { id: organizationId } });

    // After the cascade, so "no memberships left" already excludes this one.
    const deleted = await tx.user.deleteMany({
      where: { id: { in: memberIds }, memberships: { none: {} }, isPlatformAdmin: false },
    });
    return deleted.count;
  });

  // ── 3. Photo files ────────────────────────────────────────────────────────
  const keys = organization.files.map((file) => file.storageKey);
  let filesNotRemoved = 0;

  const driver = keys.length > 0 ? storage() : null;
  if (keys.length > 0 && !driver) {
    // Rows existed but storage is no longer configured: the objects are out of
    // reach from here. Loud, because someone has to remove them by hand.
    filesNotRemoved = keys.length;
  } else if (driver) {
    const results = await Promise.allSettled(keys.map((key) => driver.delete(key)));
    filesNotRemoved = results.filter((result) => result.status === 'rejected').length;
  }

  if (filesNotRemoved > 0) {
    console.error('[workspace] photo files left in storage after deleting a workspace', {
      organizationId,
      filesNotRemoved,
      // Every key starts with the organization id (storageKeyFor), so this is
      // the prefix to clear by hand.
      prefix: `${organizationId}/`,
    });
  }

  console.info('[workspace] deleted', { organizationId, users, files: keys.length, filesNotRemoved });

  return { users, files: keys.length, filesNotRemoved, subscriptionCancelled };
}
