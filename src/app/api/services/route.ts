import { Role } from '@prisma/client';

import { conflict, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import { SERVICE_SELECT } from '@/lib/services/repository';
import { createServiceSchema } from '@/lib/validation/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Readable by anyone in the workspace: staff need the catalogue to quote. */
export const GET = withRoute(async () => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const services = await auth.db.service.findMany({
    select: SERVICE_SELECT,
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });

  return jsonOk({ services });
});

/** Writable by ADMIN and up: this is what the business charges. */
export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = createServiceSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  // Appended rather than inserted at the top: the catalogue is an ordered list
  // the owner has arranged, and a new entry should not reshuffle it.
  const last = await auth.db.service.findFirst({
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  try {
    const service = await auth.db.service.create({
      data: {
        ...parsed.data,
        organizationId: auth.organization.id,
        position: (last?.position ?? -1) + 1,
      },
      select: SERVICE_SELECT,
    });

    return jsonOk({ service }, { status: 201 });
  } catch (error) {
    // The schema has a unique (organizationId, name). Relying on the constraint
    // rather than a pre-check closes the race between two simultaneous creates.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      throw conflict('You already have a service with that name.', {
        name: 'You already have a service with that name.',
      });
    }
    throw error;
  }
});
