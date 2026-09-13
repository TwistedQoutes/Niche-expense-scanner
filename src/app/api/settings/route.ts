import { Role } from '@prisma/client';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { updateOrganizationSchema } from '@/lib/validation/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SETTINGS_SELECT = {
  name: true,
  ownerName: true,
  email: true,
  phone: true,
  website: true,
  reviewUrl: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  timezone: true,
  serviceRadiusMiles: true,
} as const;

/**
 * The business's own details.
 *
 * Written through the unscoped client, like the pricing defaults: Organization is
 * the tenant itself rather than a row inside one, so the tenant extension has no
 * column to filter on. The id comes from the verified session and never from the
 * request body — which is what keeps this from being a way to edit another
 * workspace.
 *
 * ADMIN and up. The phone number here decides which workspace an inbound text
 * belongs to, and the review link is sent to every customer, so neither is a
 * field a junior crew member should be able to change.
 */
export const PATCH = withRoute(async (request) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = updateOrganizationSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const organization = await prisma.organization.update({
    where: { id: auth.organization.id },
    data: parsed.data,
    select: SETTINGS_SELECT,
  });

  return jsonOk({ settings: organization });
});
