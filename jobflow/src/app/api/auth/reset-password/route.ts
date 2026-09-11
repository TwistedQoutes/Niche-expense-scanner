import { badRequest, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { hashPassword } from '@/lib/auth/password';
import { clearSessionCookie } from '@/lib/auth/session';
import { redeemToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/client';
import { resetPasswordSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';

export const POST = withRoute(async (request) => {
  enforceRateLimit(RATE_LIMITS.passwordReset, clientIp(request));

  const parsed = resetPasswordSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const userId = await redeemToken(parsed.data.token, 'password_reset');
  if (!userId) {
    throw badRequest('That reset link has expired or has already been used.');
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      // Every session issued before this moment stops working. Whoever
      // triggered the reset may have been locking an intruder out, and a reset
      // that leaves the intruder's session alive has achieved nothing.
      sessionVersion: { increment: 1 },
    },
  });

  // Including the browser that just reset it: they should prove the new
  // password works before being let back in.
  await clearSessionCookie();

  return jsonOk({ ok: true, message: 'Your password has been changed. Please sign in.' });
});
