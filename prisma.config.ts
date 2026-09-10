// Prisma 7 no longer reads connection URLs from schema.prisma, and the CLI does
// not auto-load .env — so the URL is wired up here for migrate/introspect/studio.
// The application itself gets its connection through a driver adapter (see
// src/lib/db.ts); Next.js loads .env for the runtime.
import 'dotenv/config';

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
