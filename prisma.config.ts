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
 * Throwing on a missing URL therefore broke `npm ci` (via postinstall) and
 * `npm run build` on any host before its environment was configured, which is
 * exactly the wrong order: you cannot set build-time secrets on a deploy that
 * has never built.
 *
 * The placeholder keeps `generate` working. Commands that genuinely need a
 * database — `migrate`, `studio`, `db pull` — still fail, but at connection
 * time and with a host name that says plainly what is wrong.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://unset@database-url-is-not-set:5432/unset';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: DATABASE_URL,
  },
});
