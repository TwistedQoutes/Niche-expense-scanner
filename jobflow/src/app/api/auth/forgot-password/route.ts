import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { sendPasswordResetEmail } from '@/lib/auth/emails';
import { prisma } from '@/lib/db/client';
import { forgotPasswordSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';

export const POST = withRoute(async (request) => {
  enforceRateLimit(RATE_LIMITS.passwordReset, clientIp(request));

  const parsed = forgotPasswordSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true },
  });

  if (user) {
    // Awaited, not fire-and-forget: if the mail provider is down the caller
    // should see a 500 and retry, rather than be told to check an inbox that
    // will never receive anything.
    try {
      await sendPasswordResetEmail(user.id, user.email);
    } catch (error) {
      console.error('[forgot-password] could not send the reset email', error);
    }
  }

  // Always the same answer. Telling an anonymous caller whether an address has
  // an account turns this endpoint into an account-enumeration oracle.
  return jsonOk({
    ok: true,
    message: 'If that email has an account, a reset link is on its way.',
  });
});
