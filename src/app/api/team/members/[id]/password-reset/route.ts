import { Role } from '@prisma/client';
import { z } from 'zod';

import { conflict, forbidden, notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { issuePasswordResetLink, sendPasswordResetEmail } from '@/lib/auth/emails';
import { requireRole } from '@/lib/auth/context';
import { emailEnabled } from '@/lib/email';
import { teammateForPasswordReset } from '@/lib/team/repository';
import { idSchema } from '@/lib/validation/common';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  delivery: z.enum(['email', 'link']),
});

/**
 * An owner or admin resets a teammate's password.
 *
 * Nobody here ever chooses the teammate's password. The result is the same
 * one-hour reset link the "Forgot your password?" page sends, and the teammate
 * picks the new password themselves — which also signs them out on every device
 * (`/api/auth/reset-password`).
 *
 * Two ways to deliver it:
 *
 *  - **email**: to the teammate's own address. The owner never sees the link.
 *  - **link**: returned to the owner to pass on — for crew who never check the
 *    email they signed up with. Refused for any account that also belongs to
 *    another business or is a platform admin (see `teammateForPasswordReset`),
 *    because whoever opens the link owns the whole account.
 *
 * Every reset is written to the audit log with who sent it and how, since a
 * link in the owner's hands is a link the owner could use.
 */
export const POST = withRoute(async (request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.passwordReset, `team-reset:${auth.organization.id}`);

  if (auth.organization.isDemo) {
    throw forbidden('A demo workspace cannot reset passwords.');
  }

  const { id } = await context.params;
  const userId = idSchema.safeParse(id);
  if (!userId.success) throw notFound('That teammate does not exist.');

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));
  const { delivery } = parsed.data;

  const target = await teammateForPasswordReset(
    auth.db,
    { userId: auth.user.id, role: auth.role, organizationId: auth.organization.id },
    userId.data,
  );

  let link: string | null = null;
  let expiresAt: Date | null = null;

  if (delivery === 'email') {
    if (!emailEnabled()) {
      throw conflict(
        target.linkAllowed
          ? 'This site cannot send email yet. Get a link to pass on instead.'
          : 'This site cannot send email yet, and this person’s password can only be reset by email.',
      );
    }
    await sendPasswordResetEmail(target.userId, target.email, {
      name: auth.user.name,
      organizationName: auth.organization.name,
    });
  } else {
    if (!target.linkAllowed) throw conflict(target.linkRefusal!);
    ({ link, expiresAt } = await issuePasswordResetLink(target.userId));
  }

  await auth.db.auditLog.create({
    data: {
      organizationId: auth.organization.id,
      actorUserId: auth.user.id,
      action: 'member.password_reset_sent',
      entityType: 'user',
      entityId: target.userId,
      metadata: { delivery },
      userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    },
  });

  return jsonOk({ delivery, email: target.email, link, expiresAt });
});
