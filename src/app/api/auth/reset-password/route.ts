import { AppError, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { redeemToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db';
import { resetPasswordSchema } from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * Completes a password reset.
 *
 * Three things happen together, in one transaction:
 *
 *   1. the new password hash is stored,
 *   2. `sessionVersion` is bumped, which signs out every existing session —
 *      the whole point if the reset was prompted by a compromise,
 *   3. the email is marked verified, since redeeming the token proves control
 *      of the inbox.
 *
 * The user is then signed in with a fresh token. They have just demonstrated
 * inbox control and set the password, so a second login screen adds friction
 * without adding proof.
 */
export const POST = withRoute(async (request) => {
  enforceRateLimit(RATE_LIMITS.passwordReset, clientIp(request));

  const parsed = resetPasswordSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { token, password } = parsed.data;

  const userId = await redeemToken(token, 'password_reset');
  if (!userId) {
    throw new AppError(
      'bad_request',
      'That reset link is invalid or has expired. Request a new one.',
    );
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      sessionVersion: { increment: 1 },
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true, sessionVersion: true },
  });

  await setSessionCookie(
    await createSessionToken({
      userId: user.id,
      email: user.email,
      sessionVersion: user.sessionVersion,
    }),
  );

  return jsonOk({ ok: true });
});
