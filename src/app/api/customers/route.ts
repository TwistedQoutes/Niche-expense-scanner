import { Prisma } from '@prisma/client';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { CUSTOMER_ROW_SELECT } from '@/lib/customers/repository';
import { createCustomerSchema, listCustomersQuerySchema } from '@/lib/validation/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const parsed = listCustomersQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { search, tag, dueOnly, cursor, limit } = parsed.data;
  const where: Prisma.CustomerWhereInput = {};

  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { company: { contains: search, mode: 'insensitive' } },
      { addressLine1: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (tag) where.tags = { has: tag };
  // The reactivation worklist: who is due, soonest first.
  if (dueOnly) where.nextServiceDueAt = { lte: new Date() };

  const rows = await auth.db.customer.findMany({
    where,
    select: CUSTOMER_ROW_SELECT,
    orderBy: dueOnly
      ? [{ nextServiceDueAt: 'asc' }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const customers = hasMore ? rows.slice(0, limit) : rows;

  return jsonOk({
    customers,
    nextCursor: hasMore ? (customers.at(-1)?.id ?? null) : null,
  });
});

export const POST = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = createCustomerSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { nextServiceDueAt, tags, ...rest } = parsed.data;

  const customer = await auth.db.customer.create({
    data: {
      ...rest,
      organizationId: auth.organization.id,
      ...(tags === undefined ? {} : { tags }),
      nextServiceDueAt: nextServiceDueAt ? new Date(nextServiceDueAt) : null,
    },
    select: CUSTOMER_ROW_SELECT,
  });

  return jsonOk({ customer }, { status: 201 });
});
