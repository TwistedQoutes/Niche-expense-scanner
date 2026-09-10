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

/**
 * Connecting (and therefore validating env) happens lazily, on first actual
 * query, rather than at module import time. Next.js imports every route
 * module while collecting page data at build time — without a real
 * DATABASE_URL/AUTH_SECRET yet — and an eager connection here would fail
 * that step even though no query is ever run during a build.
 */
function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const client = createPrismaClient();
    if (getEnv().NODE_ENV !== 'production') {
      globalForPrisma.prisma = client;
    }
    return client;
  }
  return globalForPrisma.prisma;
}

let singleton: PrismaClient | undefined;

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    if (!singleton) singleton = getPrismaClient();
    return Reflect.get(singleton as object, prop, receiver);
  },
});
