import { Role } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { PRICING_RULE_SELECT } from '@/lib/services/repository';
import { idSchema } from '@/lib/validation/common';
import { updatePricingRuleSchema } from '@/lib/validation/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That rule does not exist.');
  return parsed.data;
}

export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const parsed = updatePricingRuleSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const changed = await auth.db.pricingRule.updateMany({ where: { id }, data: parsed.data });
  if (changed.count === 0) throw notFound('That rule does not exist.');

  const rule = await auth.db.pricingRule.findUnique({ where: { id }, select: PRICING_RULE_SELECT });

  return jsonOk({ rule });
});

export const DELETE = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const deleted = await auth.db.pricingRule.deleteMany({ where: { id } });
  if (deleted.count === 0) throw notFound('That rule does not exist.');

  return jsonOk({ ok: true });
});
