import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { moveLead } from '@/lib/leads/repository';
import { idSchema } from '@/lib/validation/common';
import { moveLeadSchema } from '@/lib/validation/leads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dropping a card on the pipeline board.
 *
 * Separate from PATCH /api/leads/[id] because it is a different operation with
 * different semantics: it takes the two cards the user dropped between rather
 * than a position, it can respace a column, and it is called on every drag —
 * so it stays small and does not carry the general update path's weight.
 */
export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) throw notFound('That lead does not exist.');

  const parsed = moveLeadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const lead = await moveLead(
    auth.db,
    auth.organization.id,
    parsedId.data,
    parsed.data,
    auth.user.id,
  );

  return jsonOk({ lead });
});
