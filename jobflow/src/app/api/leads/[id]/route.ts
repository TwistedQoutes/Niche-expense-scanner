import { LeadStatus, Role } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth, requireRole } from '@/lib/auth/context';
import { LEAD_CARD_SELECT, getLead, logActivity } from '@/lib/leads/repository';
import { idSchema } from '@/lib/validation/common';
import { updateLeadSchema } from '@/lib/validation/leads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Path parameters are validated like any other input.
 *
 * An id that is merely unknown is harmless — the query returns nothing — but
 * one carrying a NUL byte reaches Postgres and crashes the query, which any
 * client can trigger with a single character in the URL.
 */
async function readId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That lead does not exist.');
  return parsed.data;
}

export const GET = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const lead = await getLead(auth.db, await readId(context.params));

  return jsonOk({ lead });
});

export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const parsed = updateLeadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const existing = await auth.db.lead.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) throw notFound('That lead does not exist.');

  const { nextFollowUpAt, lastContactedAt, ...rest } = parsed.data;

  const lead = await auth.db.lead.update({
    where: { id },
    data: {
      ...rest,
      ...(nextFollowUpAt === undefined
        ? {}
        : { nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null }),
      ...(lastContactedAt === undefined
        ? {}
        : { lastContactedAt: lastContactedAt ? new Date(lastContactedAt) : null }),
      // Same closed-at bookkeeping as a board move, so editing a lead's status
      // from the detail page does not leave the funnel measuring from nothing.
      ...(rest.status && rest.status !== existing.status
        ? rest.status === LeadStatus.WON || rest.status === LeadStatus.LOST
          ? { closedAt: new Date() }
          : { closedAt: null }
        : {}),
    },
    select: LEAD_CARD_SELECT,
  });

  if (rest.status && rest.status !== existing.status) {
    await logActivity(auth.db, auth.organization.id, {
      leadId: id,
      type: 'status_changed',
      summary: `Moved from ${existing.status} to ${rest.status}`,
      detail: { from: existing.status, to: rest.status },
      actorUserId: auth.user.id,
    });
  }

  return jsonOk({ lead });
});

export const DELETE = withRoute(async (_request, context: { params: Promise<{ id: string }> }) => {
  // ADMIN and up. A deleted lead takes its activity trail with it, and losing
  // the record of how a customer was won is not something a new hire should be
  // able to do on their first day.
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const deleted = await auth.db.lead.deleteMany({ where: { id } });
  if (deleted.count === 0) throw notFound('That lead does not exist.');

  return jsonOk({ ok: true });
});
