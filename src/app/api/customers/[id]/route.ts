import { Role } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import {
  CUSTOMER_ROW_SELECT,
  getCustomerDetail,
  getCustomerSummary,
} from '@/lib/customers/repository';
import { idSchema } from '@/lib/validation/common';
import { updateCustomerSchema } from '@/lib/validation/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That customer does not exist.');
  return parsed.data;
}

export const GET = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const id = await readId(context.params);
  const [customer, summary] = await Promise.all([
    getCustomerDetail(auth.db, id),
    getCustomerSummary(auth.db, id),
  ]);

  return jsonOk({ customer, summary });
});

export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const parsed = updateCustomerSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { nextServiceDueAt, tags, ...rest } = parsed.data;

  // updateMany rather than update: it returns a count instead of throwing
  // Prisma's P2025, so an id from another tenant reads as "not found" — which
  // is what it is — rather than as a 500.
  const changed = await auth.db.customer.updateMany({
    where: { id },
    data: {
      ...rest,
      ...(tags === undefined ? {} : { tags }),
      ...(nextServiceDueAt === undefined
        ? {}
        : { nextServiceDueAt: nextServiceDueAt ? new Date(nextServiceDueAt) : null }),
    },
  });

  if (changed.count === 0) throw notFound('That customer does not exist.');

  const customer = await auth.db.customer.findUnique({
    where: { id },
    select: CUSTOMER_ROW_SELECT,
  });

  return jsonOk({ customer });
});

export const DELETE = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  // Deleting a customer cascades their properties, quotes and jobs — the whole
  // commercial record of a relationship. ADMIN and up.
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const deleted = await auth.db.customer.deleteMany({ where: { id } });
  if (deleted.count === 0) throw notFound('That customer does not exist.');

  return jsonOk({ ok: true });
});
