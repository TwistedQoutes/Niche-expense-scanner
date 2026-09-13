import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { convertLead } from '@/lib/leads/repository';
import { idSchema } from '@/lib/validation/common';
import { convertLeadSchema } from '@/lib/validation/leads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Turns a won lead into a customer record (and a property, where there is an address). */
export const POST = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) throw notFound('That lead does not exist.');

  const parsed = convertLeadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const result = await convertLead(
    auth.db,
    auth.organization.id,
    parsedId.data,
    parsed.data,
    auth.user.id,
  );

  return jsonOk(result, { status: 201 });
});
