import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { getEnv } from '@/lib/env';

/**
 * Prisma 7 connects through a driver adapter rather than a URL in the schema.
 *
 * The pool is deliberately small. Serverless platforms run many short-lived
 * instances, and each one holding a large pool exhausts a managed Postgres'
 * connection limit long before the app is actually busy — the classic way a
 * Next.js deployment falls over under mild load. Use a pooled connection
 * string (pgBouncer, Neon's `-pooler` host, Supabase's port 6543) in
 * production and this stays comfortable.
 */
function createPrismaClient(): PrismaClient {
  const env = getEnv();

  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    // Fail fast rather than hanging a request for 30s on an unreachable database.
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

/**
 * Next's dev server re-evaluates modules on every hot reload, which would leak
 * a new connection pool each time; caching on globalThis keeps exactly one.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (getEnv().NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
