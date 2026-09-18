import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { effectivePlan } from '@/lib/billing/usage';
import { listTeam, seatUsage } from '@/lib/team/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Who is here, who has been asked, and how many seats that uses.
 *
 * Readable by anyone in the workspace. A crew member seeing the names of the
 * people they work beside is not a disclosure, and hiding it would make the
 * "assign to" list on a job impossible to explain. What they cannot do is change
 * any of it — that is `POST /api/team/invites` and the member routes, all ADMIN
 * and up.
 *
 * The /team screen does not use this; being a server component, it calls the
 * repository directly. This exists for clients and for tests, which is why it
 * returns the same three things the screen renders.
 */
export const GET = withRoute(async () => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.read, auth.organization.id);

  const [team, seats] = await Promise.all([
    listTeam(auth.db, { userId: auth.user.id, role: auth.role }),
    seatUsage(auth.db, effectivePlan(auth.subscription)),
  ]);

  return jsonOk({ ...team, seats });
});
