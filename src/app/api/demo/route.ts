import { randomBytes } from 'node:crypto';

import { notImplemented } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, clientIp, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import {
  DEMO_ACCOUNT_DOMAIN,
  DEMO_BUSINESS_PHONE,
  seedDemoWorkspace,
} from '@/lib/demo/seed';
import { getEnv } from '@/lib/env';
import { provisionOrganization } from '@/lib/organizations/provision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Spins up a throwaway demo workspace and signs the visitor into it.
 *
 * **A fresh workspace per visitor**, not one shared sandbox. A shared demo is a
 * place where one visitor's typing is the next visitor's first impression, and
 * where anything typed into it — which will include real phone numbers and real
 * names, because people test with their own — is visible to strangers. Isolation
 * is cheaper than moderating that.
 *
 * What keeps a demo from doing harm in the real world:
 *
 *  - `isDemo` is set on the workspace, and `sendMessage` refuses to hand anything
 *    from a demo workspace to a carrier. A visitor can type their own number into
 *    a customer record; nothing will text it.
 *  - The seeded contacts use the 555 range reserved for fiction and
 *    `example.test`, so even a failure of the block above lands nowhere.
 *  - Checkout refuses a demo workspace, so nobody can put a card into something
 *    that is about to be deleted.
 *  - The account is thrown away: a random unguessable password nobody is told, so
 *    the only way back in is this session's cookie.
 *  - The daily sweep deletes demos older than `DEMO_TTL_HOURS`.
 *
 * Off unless `DEMO_MODE=on`. It is an unauthenticated route that writes, and a
 * deployment that did not ask for that should not have it.
 */
export const POST = withRoute(async (request) => {
  const env = getEnv();

  if (!env.DEMO_MODE) {
    throw notImplemented('Demo mode is not enabled on this deployment.');
  }

  enforceRateLimit(RATE_LIMITS.demo, clientIp(request));

  const token = randomBytes(9).toString('hex');
  const email = `demo-${token}@${DEMO_ACCOUNT_DOMAIN}`;

  /*
   * A password nobody knows, and nobody is ever shown. The session cookie is the
   * only way into this workspace, which is what makes the throwaway account safe
   * to create without a person behind it.
   */
  const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));

  const result = await prisma.$transaction(
    async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: 'Demo owner',
          // Verified, so the demo does not open on a "confirm your email" notice
          // for an address that can never receive one.
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true, name: true, sessionVersion: true },
      });

      const organization = await provisionOrganization(tx, user.id, {
        businessName: 'Green Thumb Lawn Care',
        ownerName: 'Demo owner',
        email,
        phone: DEMO_BUSINESS_PHONE,
        industry: 'lawn_care',
        isDemo: true,
      });

      // The whole demo in one transaction: a half-seeded workspace would show a
      // prospect a broken product, which is worse than showing them nothing.
      const seeded = await seedDemoWorkspace(tx, organization.id);

      return { user, organization, seeded };
    },
    // Seeding writes a few hundred rows; the default five seconds is not enough
    // on a cold connection.
    { timeout: 30_000 },
  );

  await setSessionCookie(
    await createSessionToken({
      userId: result.user.id,
      email: result.user.email,
      organizationId: result.organization.id,
      sessionVersion: result.user.sessionVersion,
    }),
  );

  return jsonOk({ ok: true, organizationId: result.organization.id }, { status: 201 });
});
