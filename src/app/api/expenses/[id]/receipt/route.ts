import { AppError, notFound } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db';
import {
  MAX_STORED_IMAGE_BYTES,
  buildImageKey,
  extensionFor,
  isValidImageKey,
  resolveStorage,
  sniffImageType,
} from '@/lib/storage';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Receipt image retention.
 *
 * Three deliberate gates before a single byte is written:
 *
 *   1. The deployment must have a storage driver configured at all.
 *   2. The artist must have opted in on their account.
 *   3. The expense must belong to them.
 *
 * When retention is off the routes report 404 rather than 403, because from the
 * caller's point of view the feature genuinely does not exist here — and it
 * keeps the "we don't store your images" claim literally true.
 */
function requireStorage() {
  const storage = resolveStorage();
  if (!storage) {
    throw notFound('Receipt images are not stored by this installation.');
  }
  return storage;
}

async function ownedExpense(expenseId: string, userId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, userId },
    select: { id: true, imageKey: true, imageMimeType: true },
  });
  if (!expense) throw notFound('That expense no longer exists.');
  return expense;
}

export const POST = withRoute(async (request: Request, context: RouteContext) => {
  const storage = requireStorage();
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.write, user.id);

  if (!user.storeReceiptImages) {
    throw new AppError(
      'forbidden',
      'Turn on receipt image storage in your settings before uploading.',
    );
  }

  const { id } = await context.params;
  const expense = await ownedExpense(id, user.id);

  // Reject on the declared length first, so an oversized body is refused before
  // it is buffered rather than after.
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_STORED_IMAGE_BYTES) {
    throw new AppError('payload_too_large', 'That image is larger than 5 MB.');
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    throw new AppError('bad_request', 'Expected an image in the "file" field.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // content-length can lie or be absent, so the real size is checked too.
  if (bytes.byteLength === 0) throw new AppError('bad_request', 'That image was empty.');
  if (bytes.byteLength > MAX_STORED_IMAGE_BYTES) {
    throw new AppError('payload_too_large', 'That image is larger than 5 MB.');
  }

  // The client's declared type is ignored entirely: these bytes get served back
  // to a browser later, so the type has to come from the bytes themselves.
  const type = sniffImageType(bytes);
  if (!type) {
    throw new AppError(
      'unsupported_media_type',
      'That file is not a JPEG, PNG or WebP image.',
    );
  }

  const key = buildImageKey(user.id, type);
  await storage.put(key, bytes, type);

  // Replacing an existing image: write the new one first, record it, then drop
  // the old. A crash mid-way leaves an orphaned file rather than a row pointing
  // at bytes that no longer exist.
  const previousKey = expense.imageKey;

  await prisma.expense.update({
    where: { id: expense.id },
    data: { imageKey: key, imageMimeType: type, imageBytes: bytes.byteLength },
  });

  if (previousKey && previousKey !== key && isValidImageKey(previousKey)) {
    await storage.delete(previousKey).catch((error: unknown) => {
      // The new image is already live; a failure to tidy up the old one is a
      // housekeeping problem, not a request failure.
      console.error('[receipt] could not remove the replaced image', { previousKey, error });
    });
  }

  return jsonOk({ stored: true, bytes: bytes.byteLength, contentType: type }, { status: 201 });
});

export const GET = withRoute(async (_request: Request, context: RouteContext) => {
  const storage = requireStorage();
  const user = await requireUser();

  const { id } = await context.params;
  const expense = await ownedExpense(id, user.id);

  if (!expense.imageKey || !isValidImageKey(expense.imageKey)) {
    throw notFound('No image is stored for that expense.');
  }

  const bytes = await storage.get(expense.imageKey);
  if (!bytes) throw notFound('No image is stored for that expense.');

  // The stored mime type came from sniffing on upload, but it is re-derived
  // here rather than trusted from the database — the response header is what
  // tells the browser how to interpret these bytes.
  const type = sniffImageType(bytes);
  if (!type) throw notFound('No image is stored for that expense.');

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(bytes.byteLength),
      // Inline so it can be shown in an <img>, but named so a manual save is
      // sensible. `nosniff` stops the browser second-guessing the type.
      'Content-Disposition': `inline; filename="receipt-${expense.id}.${extensionFor(type)}"`,
      'X-Content-Type-Options': 'nosniff',
      // A receipt is private: never let a shared cache hold it.
      'Cache-Control': 'private, no-store',
    },
  });
});

export const DELETE = withRoute(async (_request: Request, context: RouteContext) => {
  const storage = requireStorage();
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.write, user.id);

  const { id } = await context.params;
  const expense = await ownedExpense(id, user.id);

  // The row is cleared first: if the file delete fails, the artist still sees
  // the image as gone, and an orphan is cleaned up rather than a phantom shown.
  await prisma.expense.update({
    where: { id: expense.id },
    data: { imageKey: null, imageMimeType: null, imageBytes: null },
  });

  if (expense.imageKey && isValidImageKey(expense.imageKey)) {
    await storage.delete(expense.imageKey);
  }

  return jsonOk({ deleted: true });
});
