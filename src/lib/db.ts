import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { getEnv } from '@/lib/env';

/**
 * Prisma 7 connects through a driver adapter rather than a URL in the schema.
 *
 * Swapping databases is a two-line change: point `provider` in
 * prisma/schema.prisma at "postgresql" and build a `PrismaPg` adapter here
 * instead — every query in the app is written against the portable model API.
 */
function createPrismaClient(): PrismaClient {
  const env = getEnv();

  const adapter = new PrismaBetterSqlite3({
    url: env.DATABASE_URL,
    // Keep the connection resilient under Next's concurrent route handlers.
    timeout: 5_000,
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
