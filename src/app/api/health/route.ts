import { withRoute } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/response';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Readiness probe: reports unhealthy if the database is unreachable, so a
 * load balancer pulls the instance instead of serving 500s.
 */
export const GET = withRoute(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return jsonOk({ status: 'ok', database: 'up' });
  } catch {
    return jsonOk({ status: 'degraded', database: 'down' }, { status: 503 });
  }
});
