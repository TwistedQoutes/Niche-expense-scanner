import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { getEnv } from '@/lib/env';

/**
 * Prisma 7 connects through a driver adapter rather than a URL in the schema.
 *
 * The pool is deliberately small — see the note on DATABASE_POOL_MAX in
 * src/lib/env.ts.
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
const globalForPrisma = globalThis as unknown as { jobflowPrisma?: PrismaClient };

function client(): PrismaClient {
  if (globalForPrisma.jobflowPrisma) return globalForPrisma.jobflowPrisma;

  // Cached in every environment, not just development. A serverless instance
  // handles many requests, and building a pool per request would exhaust the
  // database's connection limit almost immediately.
  globalForPrisma.jobflowPrisma = createPrismaClient();
  return globalForPrisma.jobflowPrisma;
}

/**
 * The Prisma client, constructed on first use rather than on import.
 *
 * This laziness is load-bearing for deployment. `next build` imports every
 * route module to collect page data, so an eagerly-created client would make
 * the *build* require `DATABASE_URL` and `AUTH_SECRET` — which means the app
 * could not compile on any host until production secrets were configured, and
 * a preview build could never run at all.
 *
 * A build should compile code, not connect to a database. Deferring the
 * constructor behind a proxy moves environment validation to the first real
 * query, where a missing variable is a clear runtime error instead of an
 * inscrutable build failure.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const value = Reflect.get(client(), property, receiver) as unknown;
    // Methods have to stay bound to the real client, or `this` is the proxy.
    return typeof value === 'function' ? value.bind(client()) : value;
  },
  has: (_target, property) => property in client(),
  ownKeys: () => Reflect.ownKeys(client()),
  getOwnPropertyDescriptor: (_target, property) =>
    Reflect.getOwnPropertyDescriptor(client(), property),
});
