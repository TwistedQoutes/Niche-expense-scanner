import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db';
import { MAX_STORED_IMAGE_BYTES, resolveStorage, storageEnabled } from '@/lib/storage';
import { updateSettingsSchema } from '@/lib/validation';
import type { CapabilitiesDto, UserDto } from '@/types';

export const runtime = 'nodejs';

export const GET = withRoute(async () => {
  const user = await requireUser();

  return jsonOk<{ user: UserDto; capabilities: CapabilitiesDto }>({
    user: {
      id: user.id,
      email: user.email,
      studioName: user.studioName,
      storeReceiptImages: user.storeReceiptImages,
    },
    capabilities: {
      receiptStorageAvailable: storageEnabled(),
      maxImageBytes: MAX_STORED_IMAGE_BYTES,
    },
  });
});

export const PATCH = withRoute(async (request) => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.write, user.id);

  const parsed = updateSettingsSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { storeReceiptImages } = parsed.data;

  // Turning it on where no driver is configured would be a promise the
  // deployment cannot keep, so it is refused rather than silently accepted.
  if (storeReceiptImages === true && !storageEnabled()) {
    throw validationFailed({
      storeReceiptImages: 'This installation is not configured to store receipt images.',
    });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: storeReceiptImages === undefined ? {} : { storeReceiptImages },
    select: { id: true, email: true, studioName: true, storeReceiptImages: true },
  });

  // Switching retention off is a deletion request, not just a preference
  // change: an artist who turns this off is entitled to expect the images we
  // already hold to be gone.
  if (storeReceiptImages === false) {
    const storage = resolveStorage();
    const stored = await prisma.expense.findMany({
      where: { userId: user.id, imageKey: { not: null } },
      select: { id: true, imageKey: true },
    });

    await prisma.expense.updateMany({
      where: { userId: user.id },
      data: { imageKey: null, imageMimeType: null, imageBytes: null },
    });

    if (storage) {
      for (const expense of stored) {
        if (!expense.imageKey) continue;
        await storage.delete(expense.imageKey).catch((error: unknown) => {
          console.error('[settings] could not remove a stored receipt image', {
            expenseId: expense.id,
            error,
          });
        });
      }
    }
  }

  return jsonOk<{ user: UserDto }>({ user: updated });
});
