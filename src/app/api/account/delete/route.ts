import { AppError, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { verifyPassword } from '@/lib/auth/password';
import { clearSessionCookie } from '@/lib/auth/session';
import { getStripe } from '@/lib/billing/stripe';
import { prisma } from '@/lib/db';
import { deleteAccountSchema } from '@/lib/validation';
import { isValidImageKey, resolveStorage } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * Deletes the account and everything in it, for real.
 *
 * Required by GDPR Article 17 and the CCPA, and the right thing regardless —
 * but the order matters. Files on disk go first, because once the row is gone
 * its `imageKey` is gone with it and the bytes would be orphaned forever with
 * nothing left pointing at them.
 *
 * The current password is required. Deletion is irreversible, so a borrowed
 * session on an unlocked phone must not be enough to trigger it.
 *
 * The Stripe subscription is cancelled rather than deleted: Stripe is a
 * financial record, and its retention is governed by tax law, not by us.
 */
export const POST = withRoute(async (request) => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.write, user.id);

  const parsed = deleteAccountSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, stripeSubscriptionId: true },
  });
  if (!record) throw new AppError('not_found', 'That account no longer exists.');

  if (!(await verifyPassword(parsed.data.password, record.passwordHash))) {
    throw validationFailed({ password: 'That password is not correct.' });
  }

  // 1. Stored images, while we can still find them.
  const storage = resolveStorage();
  if (storage) {
    const withImages = await prisma.expense.findMany({
      where: { userId: user.id, imageKey: { not: null } },
      select: { imageKey: true },
    });

    for (const expense of withImages) {
      if (!expense.imageKey || !isValidImageKey(expense.imageKey)) continue;
      await storage.delete(expense.imageKey).catch((error: unknown) => {
        console.error('[account-delete] could not remove a stored image', error);
      });
    }
  }

  // 2. Stop the billing relationship, so a deleted account is never charged again.
  const stripe = getStripe();
  if (stripe && record.stripeSubscriptionId) {
    await stripe.subscriptions.cancel(record.stripeSubscriptionId).catch((error: unknown) => {
      // Logged loudly: this one costs the customer money if it silently fails.
      console.error('[account-delete] could not cancel the Stripe subscription', {
        subscriptionId: record.stripeSubscriptionId,
        error,
      });
    });
  }

  // 3. The account. Expenses, lines and auth tokens cascade from here.
  await prisma.user.delete({ where: { id: user.id } });

  await clearSessionCookie();

  return jsonOk({ deleted: true });
});
