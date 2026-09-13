// Prisma 7 no longer reads connection URLs from schema.prisma, and the CLI does
// not auto-load .env — so the URL is wired up here for migrate/introspect/studio.
// The application itself connects through a driver adapter (see src/lib/db.ts);
// Next.js loads .env for the runtime.
import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * A missing DATABASE_URL must not be fatal *here*.
 *
 * This config is loaded for every Prisma command, including `generate` — which
 * only reads the schema and writes TypeScript, and never opens a connection.
 * Throwing on a missing URL would break `npm ci` (via postinstall) and
 * `npm run build` on any host before its environment is configured, which is
 * exactly the wrong order: you cannot set build-time secrets on a deploy that
 * has never built.
 *
 * The placeholder keeps `generate` working. Commands that genuinely need a
 * database — `migrate`, `studio`, `db pull` — still fail, but at connection
 * time and with a host name that says plainly what is wrong.
 */
/**
 * Migrations want the DIRECT connection, not the pooled one.
 *
 * `DATABASE_URL` is meant to point at a pooled endpoint in production — that is
 * what a serverless deployment needs, and what `.env.example` tells you to set.
 * But `prisma migrate` takes advisory locks and runs DDL, and a transaction
 * pooler cannot carry either: the migration either hangs or fails in a way that
 * does not mention pooling. So when `DIRECT_URL` is set, every Prisma CLI command
 * uses it, and `DATABASE_URL` is left to the application at request time.
 *
 * This was documented before it was wired up: `.env.example` described
 * `DIRECT_URL` and the README told you to set it, while nothing read it, so
 * `migrate deploy` went through the pooler anyway.
 */
const MIGRATION_URL =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  'postgresql://unset@database-url-is-not-set:5432/unset';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'node --env-file=.env scripts/seed.mjs',
  },
  datasource: {
    url: MIGRATION_URL,
  },
});
