import { Role } from '@prisma/client';

import { conflict, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireRole } from '@/lib/auth/context';
import { sendTeamInviteEmail } from '@/lib/auth/emails';
import { effectivePlan } from '@/lib/billing/usage';
import { emailEnabled } from '@/lib/email';
import { getEnv } from '@/lib/env';
import { inviteTeammate, roleLabel } from '@/lib/team/repository';
import { createInviteSchema } from '@/lib/validation/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Inviting is ADMIN and up: it decides who can see the customer list. */
export const POST = withRoute(async (request) => {
  const auth = await requireRole(Role.ADMIN);
  enforceRateLimit(RATE_LIMITS.invite, auth.organization.id);

  /*
   * A demo workspace cannot invite anybody.
   *
   * Checked before anything else, and for the same reason `sendMessage` refuses to
   * hand a demo's text to a carrier: the demo is seeded with fictional people and
   * handed to strangers, and an unauthenticated visitor who can make it email a
   * real address has been given a way to send mail from our domain to whoever they
   * like.
   */
  if (auth.organization.isDemo) {
    throw conflict('A demo workspace cannot invite teammates. Sign up for a free account first.');
  }

  const parsed = createInviteSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { invitation, token } = await inviteTeammate(
    auth.db,
    {
      organizationId: auth.organization.id,
      plan: effectivePlan(auth.subscription),
      actor: { userId: auth.user.id, role: auth.role },
    },
    parsed.data,
  );

  /*
   * Send it if we can, and hand back the link if we cannot.
   *
   * The alternative — refusing to invite when email is unconfigured — was worse in
   * both directions. It left the feature dead on any deployment that had not set up
   * Resend yet, and it was untestable in a production build, which is what `next
   * start` and therefore CI is. This is also what a small operator wants anyway:
   * half of them will send the link over WhatsApp regardless of what we email.
   *
   * Returning the link to the *inviter* discloses nothing. They are an admin of
   * this workspace who created this invitation one line ago; it is theirs to pass
   * on. It is deliberately not returned when the email went out, so a token that
   * is already in an inbox does not also sit in a response body.
   */
  const delivered = emailEnabled();

  if (delivered) {
    // Awaited, unlike the AI scoring on a lead: the whole point of the request is
    // that an email goes out, so a failure here is a failure of the request.
    await sendTeamInviteEmail({
      email: invitation.email,
      token,
      organizationName: auth.organization.name,
      invitedByName: auth.user.name,
      roleLabel: roleLabel(invitation.role),
    });
  }

  const appUrl = getEnv().APP_URL.replace(/\/+$/, '');

  return jsonOk(
    {
      invitation,
      delivered,
      ...(delivered ? {} : { inviteUrl: `${appUrl}/invite/${encodeURIComponent(token)}` }),
    },
    { status: 201 },
  );
});
