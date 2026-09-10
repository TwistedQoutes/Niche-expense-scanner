import { conflict, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { signupSchema } from '@/lib/validation';
import type { UserDto } from '@/types';

export const runtime = 'nodejs';

export const POST = withRoute(async (request) => {
  enforceRateLimit(RATE_LIMITS.signup, clientIp(request));

  const parsed = signupSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { email, password, studioName } = parsed.data;
  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        studioName: studioName && studioName.length > 0 ? studioName : null,
      },
      select: { id: true, email: true, studioName: true, storeReceiptImages: true },
    });

    await setSessionCookie(await createSessionToken({ userId: user.id, email: user.email }));

    return jsonOk<{ user: UserDto }>({ user }, { status: 201 });
  } catch (error) {
    // P2002 = unique constraint. Relying on the constraint instead of a
    // "does this email exist?" pre-check closes the race between two
    // simultaneous signups with the same address.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      throw conflict('An account with that email already exists.', {
        email: 'An account with that email already exists.',
      });
    }
    throw error;
  }
});
