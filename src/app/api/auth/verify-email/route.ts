import { AppError, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { sendVerificationEmail } from '@/lib/auth/emails';
import { redeemToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db';
import { verifyEmailSchema } from '@/lib/validation';

export const runtime = 'nodejs';

/** Redeems a verification link. */
export const POST = withRoute(async (request) => {
  const parsed = verifyEmailSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const userId = await redeemToken(parsed.data.token, 'email_verify');
  if (!userId) {
    throw new AppError('bad_request', 'That confirmation link is invalid or has expired.');
  }

  await prisma.user.update({
    where: { id: userId },
    // Not overwritten if already set: the first confirmation is the meaningful one.
    data: { emailVerifiedAt: new Date() },
  });

  return jsonOk({ verified: true });
});

/** Re-sends the link, for the common case of it landing in spam. */
export const PUT = withRoute(async () => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.passwordReset, user.id);

  if (user.emailVerifiedAt) return jsonOk({ alreadyVerified: true });

  try {
    await sendVerificationEmail(user.id, user.email);
  } catch (error) {
    console.error('[verify-email] could not send', { userId: user.id, error });
    throw new AppError('internal_error', 'Could not send that email. Please try again shortly.');
  }

  return jsonOk({ sent: true });
});
