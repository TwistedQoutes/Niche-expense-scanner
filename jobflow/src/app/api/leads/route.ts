import { UsageMetric } from '@prisma/client';

import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { effectivePlan, enforceUsageLimit, recordUsage } from '@/lib/billing/usage';
import { createLead, listLeads } from '@/lib/leads/repository';
import { createLeadSchema, listLeadsQuerySchema } from '@/lib/validation/leads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withRoute(async (request) => {
  const auth = await requireAuth();
  // Keyed on the organization, not the IP: one business hammering the list
  // endpoint should not slow down another that shares an office building.
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const parsed = listLeadsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { leads, nextCursor } = await listLeads(auth.db, parsed.data);

  return jsonOk({ leads, nextCursor });
});

export const POST = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const parsed = createLeadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const plan = effectivePlan(auth.subscription);
  await enforceUsageLimit(auth.db, plan, UsageMetric.LEADS);

  const { nextFollowUpAt, ...rest } = parsed.data;

  const lead = await createLead(
    auth.db,
    auth.organization.id,
    {
      ...rest,
      nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null,
    },
    auth.user.id,
  );

  // Recorded after the write succeeds, so a lead that failed validation or hit
  // a constraint does not spend someone's monthly allowance.
  await recordUsage(auth.db, auth.organization.id, UsageMetric.LEADS);

  return jsonOk({ lead }, { status: 201 });
});
