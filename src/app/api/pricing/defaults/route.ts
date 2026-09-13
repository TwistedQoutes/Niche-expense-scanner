import { Role } from '@prisma/client';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { updatePricingDefaultsSchema } from '@/lib/validation/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The workspace pricing defaults every quote starts from.
 *
 * Written through the unscoped client rather than `auth.db`, because
 * Organization is the tenant itself and not a row inside one — the tenant
 * extension has no `organizationId` column to filter on there. The id comes
 * from the verified session, never from the request.
 */
export const PATCH = withRoute(async (request) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = updatePricingDefaultsSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const organization = await prisma.organization.update({
    where: { id: auth.organization.id },
    data: parsed.data,
    select: {
      defaultLaborRateCents: true,
      defaultProfitMarginBps: true,
      defaultTravelFeeCents: true,
      defaultMinimumJobCents: true,
      defaultOverheadCents: true,
      defaultTaxRateBps: true,
    },
  });

  return jsonOk({ defaults: organization });
});
