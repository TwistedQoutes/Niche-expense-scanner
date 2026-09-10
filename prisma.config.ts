// Prisma 7 no longer reads connection URLs from schema.prisma, and the CLI does
// not auto-load .env — so the URL is wired up here for migrate/introspect/studio.
// The application itself gets its connection through a driver adapter (see
// src/lib/db.ts); Next.js loads .env for the runtime.
//
// `prisma generate` (run in postinstall/build) doesn't touch the database, so
// it must not hard-require DATABASE_URL via `env()` — that throws at config
// load time and breaks installs on hosts that haven't set it yet. Fall back to
// the same zero-config SQLite file used in .env.example.
import 'dotenv/config';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL || 'file:./prisma/dev.db',
  },
});
