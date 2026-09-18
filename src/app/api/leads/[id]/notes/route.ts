import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { logActivity } from '@/lib/leads/repository';
import { idSchema } from '@/lib/validation/common';
import { addLeadNoteSchema } from '@/lib/validation/leads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Adds a note to a lead's timeline.
 *
 * Notes are activity rows rather than an edit to `Lead.notes`, so "called, no
 * answer, trying again Thursday" keeps its timestamp and its author instead of
 * overwriting whatever was there. `Lead.notes` stays as the standing summary.
 */
export const POST = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) throw notFound('That lead does not exist.');

  const parsed = addLeadNoteSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  // Confirms the lead exists (and, through the tenant client, that it is ours)
  // before writing an activity row that would otherwise dangle.
  const lead = await auth.db.lead.findUnique({ where: { id: parsedId.data }, select: { id: true } });
  if (!lead) throw notFound('That lead does not exist.');

  await logActivity(auth.db, auth.organization.id, {
    leadId: lead.id,
    type: 'note',
    summary: parsed.data.note,
    actorUserId: auth.user.id,
  });

  // Adding a note is contact, and the follow-up queue sorts on it.
  await auth.db.lead.update({
    where: { id: lead.id },
    data: { lastContactedAt: new Date() },
  });

  return jsonOk({ ok: true }, { status: 201 });
});
