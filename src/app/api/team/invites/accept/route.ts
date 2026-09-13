import { conflict, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { acceptInvitation, resolveInvitation } from '@/lib/team/repository';
import { acceptInviteSchema, claimInviteSchema } from '@/lib/validation/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Takes up an invitation.
 *
 * Unauthenticated by necessity — the person accepting may have no account at all,
 * which is the whole point of an invitation. Three things carry the weight:
 *
 *  - The **token is the only input that selects anything.** The organization, the
 *    role and the email address all come out of the row it identifies; nothing the
 *    caller sends can redirect this at another workspace or upgrade the role they
 *    are being given. Same shape as the public quote page.
 *  - **Rate limited by IP**, because it is reachable without a session and each
 *    call hashes a password.
 *  - **Single-use**, enforced by a conditional update inside `acceptInvitation`
 *    rather than by checking first and writing after.
 *
 * A brand-new person is signed in on success: they have just proved they hold an
 * invitation sent to their address and chosen a password, which is strictly more
 * than signup asks for.
 */
export const POST = withRoute(async (request) => {
  enforceRateLimit(RATE_LIMITS.login, clientIp(request));

  const body = await readJsonBody(request);

  /*
   * Which of the two shapes applies is decided by the *database*, not by what the
   * caller sent. Trusting a `hasAccount` flag from the request would let someone
   * holding an invitation for an address that already has an account send a
   * password and have it written over the existing one.
   */
  const claim = claimInviteSchema.safeParse(body);
  if (!claim.success) throw validationFailed(toFieldErrors(claim.error));

  const invitation = await resolveInvitation(claim.data.token);
  if (!invitation) {
    throw conflict('That invitation is no longer valid. Ask whoever invited you for a new one.');
  }

  if (invitation.hasAccount) {
    /*
     * The address already has an account, so joining is attaching a membership to
     * it — and that must be done by whoever can actually sign in as them, not by
     * whoever is holding the link. So no session is minted here: they are sent to
     * sign in, and the membership is created for them first so it is waiting.
     */
    await acceptInvitation(claim.data.token, null);

    return jsonOk({ outcome: 'joined', email: invitation.email, signInRequired: true });
  }

  const parsed = acceptInviteSchema.safeParse(body);
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const accepted = await acceptInvitation(parsed.data.token, {
    name: parsed.data.name,
    passwordHash: await hashPassword(parsed.data.password),
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: accepted.userId },
    select: { email: true },
  });

  await setSessionCookie(
    await createSessionToken({
      userId: accepted.userId,
      email: user.email,
      organizationId: accepted.organizationId,
      sessionVersion: accepted.sessionVersion,
    }),
  );

  return jsonOk({ outcome: 'joined', signInRequired: false }, { status: 201 });
});
