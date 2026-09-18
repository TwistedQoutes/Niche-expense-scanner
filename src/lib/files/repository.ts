import { FileKind, Prisma } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { assertOwned } from '@/lib/db/ownership';
import type { TenantClient } from '@/lib/db/tenant';
import { MAX_UPLOAD_BYTES, requireStorage, sniffImage, storageKeyFor } from '@/lib/storage';

/**
 * Job photographs.
 *
 * The evidence half of the product: what the yard looked like before, what it
 * looked like after, and the fact that both were taken. For a disputed job it is
 * the only thing either side has, which is why a photo is written to storage and
 * to the database as one act — a row pointing at bytes that are not there is worse
 * than no row, because it reads as a photo that has been deleted.
 */

export const FILE_SELECT = {
  id: true,
  kind: true,
  fileName: true,
  mimeType: true,
  bytes: true,
  caption: true,
  createdAt: true,
} satisfies Prisma.FileSelect;

export type FileRow = Prisma.FileGetPayload<{ select: typeof FILE_SELECT }>;

/** The two that matter for a job, in the order the work happened. */
export const JOB_PHOTO_KINDS = [FileKind.JOB_BEFORE, FileKind.JOB_AFTER] as const;
export type JobPhotoKind = (typeof JOB_PHOTO_KINDS)[number];

export async function listJobPhotos(db: TenantClient, jobId: string): Promise<FileRow[]> {
  return db.file.findMany({
    where: { jobId },
    select: FILE_SELECT,
    // Before then after, then oldest first inside each.
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
  });
}

export type UploadInput = {
  jobId: string;
  kind: JobPhotoKind;
  fileName: string;
  bytes: Uint8Array;
  caption?: string | null;
};

/**
 * Stores one photo against a job.
 *
 * Three things are decided here rather than trusted from the request: what the
 * file *is* (by its leading bytes, not its name or its declared type), where it
 * goes (a server-generated key under the organization's prefix), and that the job
 * it claims to belong to is this business's job.
 */
export async function uploadJobPhoto(
  db: TenantClient,
  organizationId: string,
  input: UploadInput,
): Promise<FileRow> {
  if (input.bytes.length === 0) {
    throw validationFailed({ file: 'That file is empty.' });
  }

  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    throw validationFailed({
      file: `That photo is ${Math.round(input.bytes.length / 1024 / 1024)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    });
  }

  /*
   * What the bytes actually are. A client-declared `Content-Type` is a suggestion,
   * and an HTML file named `before.jpg` is the oldest stored-XSS trick there is —
   * it matters most at the moment the file is served back, which is why the type
   * recorded here is the sniffed one and the download route sends that.
   */
  const sniffed = sniffImage(input.bytes);
  if (!sniffed) {
    throw validationFailed({
      file: 'That does not look like a photo. JPEG, PNG, WebP and HEIC are accepted.',
    });
  }

  // Ours? The tenant client makes "exists" and "is mine" the same question.
  await assertOwned(db, { jobId: input.jobId });

  const driver = requireStorage();
  const storageKey = storageKeyFor(organizationId, sniffed.extension);

  // Bytes first. A row pointing at nothing is a photo that appears to have been
  // deleted; bytes with no row are an orphan nobody sees and the sweep can drop.
  await driver.put(storageKey, input.bytes, sniffed.mime);

  return db.file.create({
    data: {
      organizationId,
      jobId: input.jobId,
      kind: input.kind,
      storageKey,
      // Display only, and never used to build a path.
      fileName: input.fileName.slice(0, 200),
      mimeType: sniffed.mime,
      bytes: input.bytes.length,
      caption: input.caption?.slice(0, 500) ?? null,
    },
    select: FILE_SELECT,
  });
}

/**
 * Reads a file back, scoped to the caller's business.
 *
 * The lookup goes through the tenant client, so a file id belonging to another
 * organization is simply absent — the download route turns that into the same 404
 * as an id that never existed.
 */
export async function readFile(
  db: TenantClient,
  id: string,
): Promise<{ row: FileRow; body: Uint8Array } | null> {
  const file = await db.file.findUnique({
    where: { id },
    select: { ...FILE_SELECT, storageKey: true },
  });
  if (!file) return null;

  const object = await requireStorage().get(file.storageKey);
  if (!object) return null;

  const { storageKey: _storageKey, ...row } = file;
  return { row, body: object.body };
}

/**
 * Removes a photo.
 *
 * The row goes first. If the object delete then fails, what is left is an
 * unreferenced blob — invisible, and cheap. The other order risks a row whose
 * bytes are gone, which is a broken image on a job nobody can explain.
 */
export async function deleteFile(db: TenantClient, id: string): Promise<void> {
  const file = await db.file.findUnique({ where: { id }, select: { id: true, storageKey: true } });
  if (!file) throw notFound('That file does not exist.');

  await db.file.deleteMany({ where: { id } });
  await requireStorage().delete(file.storageKey);
}
