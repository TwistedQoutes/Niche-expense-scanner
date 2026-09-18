import { Role } from '@prisma/client';

import { conflict, notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { SERVICE_SELECT } from '@/lib/services/repository';
import { idSchema } from '@/lib/validation/common';
import { updateServiceSchema } from '@/lib/validation/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That service does not exist.');
  return parsed.data;
}

export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const parsed = updateServiceSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  try {
    // `updateMany` rather than `update`, so a missing row comes back as a count
    // of zero instead of Prisma's P2025 exception. With `update`, an id from
    // another tenant — which the tenant client correctly filters out — surfaced
    // as an unhandled 500 and a stack trace in the logs, when the honest answer
    // is simply "not found".
    const changed = await auth.db.service.updateMany({ where: { id }, data: parsed.data });
    if (changed.count === 0) throw notFound('That service does not exist.');

    const service = await auth.db.service.findUnique({ where: { id }, select: SERVICE_SELECT });

    return jsonOk({ service });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      throw conflict('You already have a service with that name.', {
        name: 'You already have a service with that name.',
      });
    }
    throw error;
  }
});

export const DELETE = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  // Quotes copy a service's name and price onto their own line items, so
  // deleting one never rewrites a document that has already gone out. But a
  // service still in use is almost always a mistake to delete rather than
  // deactivate, so say so instead of silently detaching it.
  const usedBy = await auth.db.quoteItem.count({ where: { serviceId: id } });
  if (usedBy > 0) {
    throw conflict(
      `That service is on ${usedBy} quote line${usedBy === 1 ? '' : 's'}. Deactivate it instead so your history stays intact.`,
    );
  }

  const deleted = await auth.db.service.deleteMany({ where: { id } });
  if (deleted.count === 0) throw notFound('That service does not exist.');

  return jsonOk({ ok: true });
});
