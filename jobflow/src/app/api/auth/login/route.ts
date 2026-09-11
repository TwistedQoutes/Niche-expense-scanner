import { MembershipStatus, OrganizationStatus } from '@prisma/client';

import { forbidden, unauthorized, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { burnPasswordTiming, verifyPassword } from '@/lib/auth/password';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { loginSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';

export const POST = withRoute(async (request) => {
  enforceRateLimit(RATE_LIMITS.login, clientIp(request));

  const parsed = loginSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      sessionVersion: true,
      passwordHash: true,
      memberships: {
        where: { status: MembershipStatus.ACTIVE },
        orderBy: { createdAt: 'asc' },
        select: {
          organizationId: true,
          organization: { select: { id: true, slug: true, name: true, status: true } },
        },
      },
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

  // Which business are they signing in to? The first active, unsuspended one
  // they belong to. A workspace switcher moves them between the rest; what must
  // never happen is a session with no organization, because every tenant-scoped
  // query is built from that value.
  const membership = user.memberships.find(
    (entry) => entry.organization.status === OrganizationStatus.ACTIVE,
  );

  if (!membership) {
    throw forbidden(
      user.memberships.length > 0
        ? 'This workspace is suspended. Please contact support.'
        : 'Your account is not attached to a workspace. Please contact support.',
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await setSessionCookie(
    await createSessionToken({
      userId: user.id,
      email: user.email,
      organizationId: membership.organizationId,
      sessionVersion: user.sessionVersion,
    }),
  );

  return jsonOk({
    user: { id: user.id, email: user.email, name: user.name },
    organization: {
      id: membership.organization.id,
      slug: membership.organization.slug,
      name: membership.organization.name,
    },
  });
});
