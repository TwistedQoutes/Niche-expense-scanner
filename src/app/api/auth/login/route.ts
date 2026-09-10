import { unauthorized, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { burnPasswordTiming, verifyPassword } from '@/lib/auth/password';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { loginSchema } from '@/lib/validation';
import type { UserDto } from '@/types';

export const runtime = 'nodejs';

export const POST = withRoute(async (request) => {
  const ip = clientIp(request);
  enforceRateLimit(RATE_LIMITS.login, ip);

  const parsed = loginSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      studioName: true,
      storeReceiptImages: true,
      sessionVersion: true,
      passwordHash: true,
    },
  });

  // One message and one timing profile for both failure modes, so this endpoint
  // cannot be used to enumerate which emails have accounts.
  const invalid = unauthorized('That email and password combination did not match.');

  if (!user) {
    await burnPasswordTiming(password);
    throw invalid;
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw invalid;
  }

  await setSessionCookie(
    await createSessionToken({
      userId: user.id,
      email: user.email,
      sessionVersion: user.sessionVersion,
    }),
  );

  return jsonOk<{ user: UserDto }>({
    user: {
      id: user.id,
      email: user.email,
      studioName: user.studioName,
      storeReceiptImages: user.storeReceiptImages,
    },
  });
});
