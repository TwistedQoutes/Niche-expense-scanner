import { prisma } from '@/lib/db';
import { isValidImageKey, resolveStorage } from '@/lib/storage';

/** Rows per database round-trip. Small enough that memory stays flat. */
const BATCH_SIZE = 200;

/**
 * Deletes every retained receipt image for one artist, in bounded batches.
 *
 * Loading all of an account's image keys at once is fine for a new user and an
 * out-of-memory crash for the artist who has been scanning daily for three
 * years — and this runs at exactly the two moments where failing is worst:
 * switching retention off (which is a deletion request) and deleting an
 * account (which must not leave orphaned files behind).
 *
 * Individual file failures are logged and stepped over rather than aborting the
 * run: one unreadable key must not strand the other ten thousand.
 *
 * Returns the number of rows whose image reference was cleared.
 */
export async function purgeStoredImages(userId: string): Promise<number> {
  const storage = resolveStorage();
  let cleared = 0;

  for (;;) {
    const batch = await prisma.expense.findMany({
      where: { userId, imageKey: { not: null } },
      select: { id: true, imageKey: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) break;

    // The row is cleared first. If a file delete fails, the result is an
    // orphaned file — wasted bytes — rather than a row pointing at an image
    // the artist has been told is gone.
    await prisma.expense.updateMany({
      where: { id: { in: batch.map((expense) => expense.id) } },
      data: { imageKey: null, imageMimeType: null, imageBytes: null },
    });
    cleared += batch.length;

    if (!storage) continue;

    for (const expense of batch) {
      if (!expense.imageKey || !isValidImageKey(expense.imageKey)) continue;
      await storage.delete(expense.imageKey).catch((error: unknown) => {
        console.error('[purge] could not remove a stored receipt image', {
          expenseId: expense.id,
          error,
        });
      });
    }
  }

  return cleared;
}
