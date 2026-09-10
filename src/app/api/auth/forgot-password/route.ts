import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { sendPasswordResetEmail } from '@/lib/auth/emails';
import { prisma } from '@/lib/db';
import { forgotPasswordSchema } from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * Starts a password reset.
 *
 * **Always answers the same way**, whether or not the address has an account.
 * A "no such user" response here would turn this endpoint into a free account
 * enumerator, which matters more than the small UX cost of not telling someone
 * they typed the wrong address.
 *
 * Rate limited hard, because each accepted request sends an email — so abuse
 * costs money and can get the sending domain blocked.
 */
export const POST = withRoute(async (request) => {
  enforceRateLimit(RATE_LIMITS.passwordReset, clientIp(request));

  const parsed = forgotPasswordSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true },
  });

  if (user) {
    try {
      await sendPasswordResetEmail(user.id, user.email);
    } catch (error) {
      // Logged, never surfaced: a mail-provider outage must not reveal that
      // this address exists, and the generic response below is still correct.
      console.error('[forgot-password] could not send the reset email', {
        userId: user.id,
        error,
      });
    }
  }

  return jsonOk({
    message: 'If that email has an account, a reset link is on its way.',
  });
});
