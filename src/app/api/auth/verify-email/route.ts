import { badRequest, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { redeemToken } from '@/lib/auth/tokens';
import { prisma } from '@/lib/db/client';
import { verifyEmailSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';

export const POST = withRoute(async (request) => {
  const parsed = verifyEmailSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const userId = await redeemToken(parsed.data.token, 'email_verify');
  if (!userId) {
    throw badRequest('That confirmation link has expired or has already been used.');
  }

  await prisma.user.update({
    where: { id: userId },
    // Not `{ increment: 1 }` on sessionVersion here: confirming an address is
    // not a security event, and signing someone out for clicking a link in
    // their own inbox would be baffling.
    data: { emailVerifiedAt: new Date() },
  });

  return jsonOk({ ok: true, message: 'Email confirmed.' });
});
