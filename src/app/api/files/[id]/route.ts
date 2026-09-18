import { Role } from '@prisma/client';

import { notFound } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import { deleteFile, readFile } from '@/lib/files/repository';
import { idSchema } from '@/lib/validation/common';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That file does not exist.');
  return parsed.data;
}

/**
 * Serving a file back.
 *
 * Every byte goes through this route, and that is the point: it is the one place
 * that decides who may see a photograph of a customer's property. A public bucket
 * or a `public/` directory would put that decision in the hands of whoever learns
 * the URL — and these are photographs taken at people's homes, with the address on
 * the job they hang off.
 *
 * Three things keep it honest:
 *
 *  - The lookup uses the tenant client, so another business's file id is absent
 *    rather than forbidden, and the answer is the same 404 as a made-up one.
 *  - The `Content-Type` sent is the one sniffed from the bytes at upload, never
 *    the one the uploader claimed.
 *  - A `sandbox` CSP and `nosniff`, so that even if something got past the
 *    sniffing it cannot act as a document in this origin. Those two headers are
 *    set in `next.config.ts` against `/api/files/:path*`, not here: a header set
 *    on the response loses to that config for the same key, and a policy that is
 *    silently overridden is worse than one that is plainly somewhere else.
 */
export const GET = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const found = await readFile(auth.db, await readId(context.params));
  if (!found) throw notFound('That file does not exist.');

  const { row, body } = found;

  return new Response(body as unknown as BodyInit, {
    headers: {
      'content-type': row.mimeType,
      'content-length': String(body.length),
      'content-disposition': `inline; filename="${encodeURIComponent(row.fileName)}"`,
      // Private: it is one business's photograph, and a shared cache holding it
      // would be a copy outside the check above.
      'cache-control': 'private, max-age=300, must-revalidate',
    },
  });
});

/** Removing a photo is ADMIN and up: it is the evidence from a job. */
export const DELETE = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  await deleteFile(auth.db, await readId(context.params));

  return jsonOk({ ok: true });
});
