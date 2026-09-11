import { conflict, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { sendVerificationEmail } from '@/lib/auth/emails';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { provisionOrganization } from '@/lib/organizations/provision';
import { signupSchema } from '@/lib/validation/auth';

export const runtime = 'nodejs';

/**
 * Create an account and the business that comes with it.
 *
 * Signup is where tenancy begins: a user on their own has nowhere to put a
 * lead, so the account and its first organization are created together, in one
 * transaction. If any part fails — a slug collision, a duplicate email — the
 * whole thing rolls back rather than leaving someone with an account they
 * cannot use.
 */
export const POST = withRoute(async (request) => {
  enforceRateLimit(RATE_LIMITS.signup, clientIp(request));

  const parsed = signupSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { email, password, businessName, ownerName, phone } = parsed.data;

  // Hashing is deliberately slow (~250ms), so it happens before the transaction
  // opens rather than inside it — holding a database transaction open across
  // bcrypt is how a connection pool gets exhausted under load.
  const passwordHash = await hashPassword(password);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: ownerName,
          phone: phone ?? null,
        },
        select: { id: true, email: true, name: true, sessionVersion: true },
      });

      const organization = await provisionOrganization(tx, user.id, {
        businessName,
        ownerName,
        email,
        phone: phone ?? null,
      });

      return { user, organization };
    });

    await setSessionCookie(
      await createSessionToken({
        userId: result.user.id,
        email: result.user.email,
        organizationId: result.organization.id,
        sessionVersion: result.user.sessionVersion,
      }),
    );

    // Verification is sent but not required to use the app: blocking a new
    // owner behind an inbox round-trip before they can see their dashboard is
    // how you lose them. It is required before a quote can be emailed from
    // their address, which is where it actually matters.
    void sendVerificationEmail(result.user.id, result.user.email).catch((error: unknown) => {
      console.error('[signup] could not send the verification email', error);
    });

    return jsonOk(
      {
        user: { id: result.user.id, email: result.user.email, name: result.user.name },
        organization: {
          id: result.organization.id,
          slug: result.organization.slug,
          name: result.organization.name,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    // P2002 = unique constraint. Relying on the constraint rather than a
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
