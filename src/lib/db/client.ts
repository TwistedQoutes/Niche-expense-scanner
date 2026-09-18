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

  const base = new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  /*
   * `$transaction` needs the same treatment, and does not get it from the
   * extension below.
   *
   * A client extension wraps model operations. Opening a transaction is not one:
   * it acquires its own connection first, so on a sleeping database it fails
   * before any wrapped operation runs — which is why signing up, the one flow
   * built entirely inside a transaction, failed in under a second while signing
   * in recovered. Creating an account is not the place to discover that.
   *
   * Retrying a whole transaction is if anything safer than retrying a statement:
   * a transaction whose connection never opened ran nothing, and one that loses
   * its connection part-way is rolled back by Postgres rather than committed. The
   * callback is re-runnable by construction — it is handed a fresh `tx`.
   */
  const openTransaction = base.$transaction.bind(base) as (...args: unknown[]) => Promise<unknown>;

  Object.defineProperty(base, '$transaction', {
    value: (...args: unknown[]) => retryWhenTheDatabaseWasAsleep({
      args,
      query: (retryArgs) => openTransaction(...(retryArgs as unknown[])),
    }),
    writable: true,
    configurable: true,
  });

  return base.$extends({ query: { $allOperations: retryWhenTheDatabaseWasAsleep } }) as
    unknown as PrismaClient;
}

/**
 * Serverless Postgres goes to sleep, and somebody has to be the one who wakes it.
 *
 * Neon, Supabase and the rest suspend an idle compute to nothing and start it
 * again on the next connection. The wake takes a second or two, and whoever
 * arrives first pays for it — which, on a quiet site, is a real person opening
 * the sign-in page. If the connection attempt times out while the server is
 * still starting, they get "something went wrong on our end" for a database that
 * is perfectly healthy and awake by the time they read it.
 *
 * So a failure to *connect* is retried once, after a short pause.
 *
 * Only a failure to connect. That distinction is the whole safety argument: if
 * the connection was never established, the statement never reached Postgres, so
 * running it again cannot repeat a write. Anything that failed after the
 * statement was sent — a constraint, a timeout mid-query, a dropped connection —
 * is not retried, because "did it commit?" is unanswerable from here and
 * charging a card twice is worse than showing an error.
 */
const CONNECTION_FAILURES = [
  // Prisma: cannot reach the server, and the connection timed out.
  'P1001',
  'P1002',
  // node-postgres, underneath: refused, unresolvable, or the pool gave up.
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'timeout exceeded when trying to connect',
  "Can't reach database server",
];

/** Exported so the rule above can be tested without a database. */
export function wasNeverConnected(error: unknown): boolean {
  const text = [
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '',
    error instanceof Error ? error.message : String(error),
  ].join(' ');

  return CONNECTION_FAILURES.some((marker) => text.includes(marker));
}

/**
 * How long to wait before each retry.
 *
 * Three attempts rather than one, because a single retry is a guess at how long
 * the wake takes and a wake is not punctual: measured against a database
 * restarting underneath it, one attempt at one second recovered *some* requests
 * and left others reporting an error for a server that was up a heartbeat later.
 * Spreading the attempts covers the range instead of betting on a number.
 *
 * Worst case adds about four seconds to a request that would otherwise have
 * failed outright, which is a trade anybody would take on the first page load of
 * the morning.
 */
const RETRY_DELAYS_MS = [400, 1_200, 2_500];

/**
 * And a ceiling on the whole exercise.
 *
 * When the database is genuinely gone — wrong host, firewall, deleted branch —
 * each attempt can burn the full connection timeout, and four of those is a
 * request that hangs for most of a minute before failing anyway. A database that
 * has not answered within this budget is not asleep; it is broken, and saying so
 * quickly is the kinder outcome.
 */
const RETRY_BUDGET_MS = 8_000;

async function retryWhenTheDatabaseWasAsleep({
  args,
  query,
}: {
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}): Promise<unknown> {
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await query(args);
    } catch (error) {
      lastError = error;

      if (!wasNeverConnected(error)) throw error;

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || Date.now() - startedAt + delay > RETRY_BUDGET_MS) break;

      if (attempt === 0) {
        console.warn('[db] could not connect; retrying — the database may have been asleep');
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
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
