import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const runtime = 'nodejs';
// Never prerendered: a health check that answers from a build-time cache is
// reporting on a database connection that no longer exists.
export const dynamic = 'force-dynamic';

/**
 * Liveness plus a real database round-trip.
 *
 * `SELECT 1` rather than a model query on purpose: it proves the pool can hand
 * out a working connection without depending on any table existing, so a
 * half-migrated deployment reports the database as reachable and fails on the
 * migration instead of on the health check.
 */
export const GET = withRoute(async () => {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error('[health] database unreachable', error);
    return jsonOk({ status: 'degraded', database: 'unreachable' }, { status: 503 });
  }

  return jsonOk({
    status: 'ok',
    database: 'ok',
    latencyMs: Date.now() - startedAt,
  });
});
