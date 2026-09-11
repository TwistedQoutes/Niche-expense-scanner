import { Role } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import { PRICING_RULE_SELECT } from '@/lib/services/repository';
import { createPricingRuleSchema } from '@/lib/validation/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withRoute(async () => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const rules = await auth.db.pricingRule.findMany({
    select: PRICING_RULE_SELECT,
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });

  return jsonOk({ rules });
});

export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = createPricingRuleSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { serviceId, ...rest } = parsed.data;

  // The tenant client stops a serviceId pointing at another business, but within
  // this one it can still be a typo — and a rule attached to nothing would
  // silently never fire.
  if (serviceId) {
    const service = await auth.db.service.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });
    if (!service) throw notFound('That service does not exist.');
  }

  const last = await auth.db.pricingRule.findFirst({
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const rule = await auth.db.pricingRule.create({
    data: {
      ...rest,
      serviceId: serviceId ?? null,
      organizationId: auth.organization.id,
      position: (last?.position ?? -1) + 1,
    },
    select: PRICING_RULE_SELECT,
  });

  return jsonOk({ rule }, { status: 201 });
});
