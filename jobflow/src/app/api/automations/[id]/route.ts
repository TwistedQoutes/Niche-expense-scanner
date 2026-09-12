import { Role } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { unknownPlaceholders } from '@/lib/messaging/templates';
import { idSchema } from '@/lib/validation/common';
import { updateAutomationSchema, updateAutomationStepSchema } from '@/lib/validation/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('That automation does not exist.');
  return parsed.data;
}

/**
 * Switching an automation on or off, and renaming it.
 *
 * ADMIN and up: these send messages to customers on the business's behalf and
 * spend its messaging allowance.
 */
export const PATCH = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const parsed = updateAutomationSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const changed = await auth.db.automation.updateMany({ where: { id }, data: parsed.data });
  if (changed.count === 0) throw notFound('That automation does not exist.');

  const automation = await auth.db.automation.findUnique({
    where: { id },
    select: { id: true, name: true, enabled: true, trigger: true },
  });

  return jsonOk({ automation });
});

/** Editing one step's timing or wording. */
export const PUT = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.write, auth.organization.id);

  const id = await readId(context.params);

  const parsed = updateAutomationStepSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  // The step has to belong to this automation, which has to belong to this
  // workspace. The tenant client guarantees the second; this checks the first,
  // so a step id from another automation cannot be edited through it.
  const step = await auth.db.automationStep.findFirst({
    where: { id: parsed.data.stepId, automation: { id, organizationId: auth.organization.id } },
    select: { id: true },
  });
  if (!step) throw notFound('That step does not exist.');

  if (parsed.data.template) {
    // A placeholder we cannot fill would render as nothing and quietly drop part
    // of the message, so it is rejected at the point of editing instead.
    const unknown = unknownPlaceholders(parsed.data.template);
    if (unknown.length > 0) {
      throw validationFailed({
        template: `These placeholders are not available: ${unknown.map((key) => `{{${key}}}`).join(', ')}`,
      });
    }
  }

  await auth.db.automationStep.update({
    where: { id: step.id },
    data: {
      delayMinutes: parsed.data.delayMinutes,
      ...(parsed.data.template === undefined ? {} : { template: parsed.data.template }),
      ...(parsed.data.subject === undefined ? {} : { subject: parsed.data.subject }),
    },
  });

  return jsonOk({ ok: true });
});
