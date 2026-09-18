import { FileKind, Role } from '@prisma/client';

import { badRequest, notFound, validationFailed } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import { JOB_PHOTO_KINDS, listJobPhotos, uploadJobPhoto } from '@/lib/files/repository';
import { MAX_UPLOAD_BYTES } from '@/lib/storage';
import { idSchema } from '@/lib/validation/common';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readJobId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That job does not exist.');
  return parsed.data;
}

/** Anyone in the workspace can see the photos on a job they are working. */
export const GET = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const files = await listJobPhotos(auth.db, await readJobId(context.params));

  return jsonOk({ files });
});

/**
 * Uploading a photo.
 *
 * `multipart/form-data`, read into memory and capped. Streaming straight to
 * storage would be leaner, but the file has to be buffered anyway to identify it
 * by its leading bytes before anything is written — and refusing an HTML file
 * dressed as a JPEG *before* it reaches the bucket is worth more than the memory.
 *
 * STAFF and up: the crew who did the work are the people holding the phone.
 */
export const POST = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.STAFF);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const jobId = await readJobId(context.params);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw badRequest('Send the photo as multipart/form-data.');
  }

  /*
   * A declared length over the cap is refused before the body is read at all.
   * The real check is on the bytes themselves — Content-Length is chosen by the
   * client like everything else here — but it turns the common case, someone
   * uploading a 40 MB photo, into an instant answer instead of a slow one.
   */
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES * 2) {
    throw validationFailed({
      file: `That photo is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest('That upload could not be read.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw validationFailed({ file: 'Choose a photo to upload.' });

  const kind = String(form.get('kind') ?? FileKind.JOB_AFTER);
  if (!JOB_PHOTO_KINDS.includes(kind as (typeof JOB_PHOTO_KINDS)[number])) {
    throw validationFailed({ kind: 'Mark the photo as before or after.' });
  }

  const caption = form.get('caption');

  const stored = await uploadJobPhoto(auth.db, auth.organization.id, {
    jobId,
    kind: kind as (typeof JOB_PHOTO_KINDS)[number],
    fileName: file.name || 'photo',
    bytes: new Uint8Array(await file.arrayBuffer()),
    caption: typeof caption === 'string' ? caption : null,
  });

  return jsonOk({ file: stored }, { status: 201 });
});
