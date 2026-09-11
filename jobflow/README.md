# JobFlow AI

**Turn Leads Into Jobs. Automatically.**

Lead-to-job management for local service businesses — lawn care, landscaping,
pressure washing, cleaning, junk removal, handyman, painting, HVAC, plumbing,
electrical and roofing.

JobFlow takes a lead through the whole journey and does the parts an owner never
gets round to:

```
LEAD → AI QUALIFICATION → CUSTOMER → PROPERTY → ESTIMATE → QUOTE
     → FOLLOW-UP → BOOKING → JOB → COMPLETION → REVIEW → REPEAT CUSTOMER
```

---

## Where this is up to

The build is phased. **Phase 1 and 2 are complete and verified**: project setup,
the full database schema, multi-tenancy, authentication, and the dashboard shell.

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Setup, Next.js, TypeScript, Tailwind, Prisma, Postgres, authentication | ✅ Done |
| 2 | Database schema, multi-tenancy, workspace provisioning | ✅ Done |
| 3 | Dashboard, navigation, UI components | ✅ Shell done |
| 4 | Customers, leads, CRM, Kanban pipeline | Next |
| 5 | Services, pricing engine, quote calculator | Planned |
| 6 | Quote generation, public quote pages, acceptance | Planned |
| 7 | AI lead qualification, AI responses | Planned |
| 8 | Email/SMS, Twilio, Resend, automated follow-up | Planned |
| 9 | Calendar, appointments, jobs | Planned |
| 10 | Review requests, customer reactivation | Planned |
| 11 | Stripe billing, subscriptions, usage limits | Planned |
| 12 | Analytics, admin dashboard | Planned |
| 13 | Landing page, onboarding, demo mode | Landing page done |
| 14 | Testing, security, performance, deployment | Ongoing |

The navigation in `src/components/layout/navigation.ts` is the whole product map,
with a `built` flag per entry. Unbuilt screens are hidden rather than shown as
dead links, and each phase flips its entries on as it lands.

---

## Requirements

- **Node.js 22.12+** (`node --version`)
- **PostgreSQL 14+** — local, or a managed host (Supabase, Neon, Railway, RDS)
- npm 10+

Nothing else is required to run the app. Every third-party integration is
optional; see [Integrations](#integrations).

---

## Installation

```bash
cd jobflow
npm install
```

`npm install` runs `prisma generate` automatically, which writes the typed
database client.

### Configure the environment

```bash
cp .env.example .env
```

Then set the two things that are genuinely required:

```bash
# 1. Where Postgres is
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/jobflow"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/jobflow"

# 2. A signing secret for sessions
AUTH_SECRET="$(openssl rand -base64 48)"
```

`.env.example` documents every variable and says what breaks without it. Read it
rather than copying keys blindly — the two Google Maps keys in particular are
deliberately separate and need different restrictions.

### Create the database

```bash
createdb jobflow                # or create it in your host's console
npm run db:migrate:deploy       # applies prisma/migrations
```

For a fresh database you can use `npm run db:migrate` instead, which creates a
new migration if you have changed the schema.

### Run it

```bash
npm run dev
```

Open <http://localhost:3000>, click **Start free**, and you have a working
workspace.

---

## What signing up actually does

Signup is not just a user row. `src/lib/organizations/provision.ts` creates the
whole starting state in one transaction:

- the **Organization** (the tenant) with pricing defaults for its trade
- a **Membership** making you its `OWNER`
- a **Subscription** on a 14-day Pro trial, no card required
- the **service catalogue** for that industry — a lawn-care workspace gets Lawn
  Mowing at $45 base, Fertilisation, Mulch Installation, Snow Removal and a
  Custom Service, each editable
- four **automations** (quote follow-up, review request, reactivation,
  missed-call text back), created disabled until the channel they need is
  configured

It is one transaction because a half-provisioned workspace — a business row with
no membership — is unreachable by the person who just signed up for it.

---

## Multi-tenancy

Every business's rows live in the same tables, separated by `organizationId`.
That works right up until one query forgets the filter, and "remember the `where`
clause" is not a security control.

So call sites do not write the filter. `forOrganization(id)` in
`src/lib/db/tenant.ts` returns a Prisma client that injects `organizationId` into
the `where` of every read and write, and into the `data` of every create, for
every tenant-owned model. The value is applied **after** whatever the caller
supplied, so a handler that passed a client-controlled id would still write the
session's own tenant.

The tenant is chosen at sign-in and carried in the session token. There is no
code path where a request parameter selects the tenant.

```ts
const auth = await requireAuth();

// Already scoped. No organizationId needed, and none would be honoured.
const leads = await auth.db.lead.findMany({ where: { status: 'NEW' } });
```

Two documented limits: nested writes (`data: { customer: { create } }`) are not
rewritten, and raw SQL bypasses Prisma-level rules entirely. Both are called out
in `src/lib/db/tenant.ts`. Postgres row-level security would close them at the
database, and the schema is shaped for it — one `organizationId` column on every
tenant table is exactly what an RLS policy keys on.

`tests/tenant-isolation.test.ts` covers every operation shape, including a caller
trying to override the tenant.

---

## Authentication

**A deliberate deviation from the original spec**, which suggested Supabase Auth
or Clerk. Authentication here is first-party: `jose` for signed session tokens,
`bcrypt` for password hashing.

The reasons:

- **No per-user cost.** This product is sold to businesses with thin margins, and
  a per-MAU auth bill scales with exactly the thing we want to grow.
- **No second source of truth for identity.** Roles, memberships and tenancy all
  live in the same database as the data they govern, so "which business am I
  acting in, as what?" is one indexed query and not a sync problem between two
  systems.
- **No vendor in the critical path** of a customer accepting a quote.

Supabase remains a first-class option for *hosting Postgres* and for storage;
those variables are in `.env.example` and unrelated to sign-in.

What it provides:

| Feature | Route |
| --- | --- |
| Sign up (creates the workspace) | `POST /api/auth/signup` |
| Sign in | `POST /api/auth/login` |
| Sign out | `POST /api/auth/logout` |
| Current user and workspace | `GET /api/auth/me` |
| Request a password reset | `POST /api/auth/forgot-password` |
| Complete a password reset | `POST /api/auth/reset-password` |
| Confirm an email address | `POST /api/auth/verify-email` |
| Sign out on every device | `POST /api/auth/sign-out-everywhere` |

Security properties worth knowing about:

- **Sessions are revocable despite being stateless.** A JWT normally cannot be
  cancelled before it expires. Each token carries the user's `sessionVersion`,
  compared against the database on every request, so a password change or an
  explicit "sign out everywhere" invalidates every outstanding token at once.
- **Reset and verification tokens are stored only as SHA-256 hashes**, and
  redeemed with a conditional update so two simultaneous requests cannot both
  succeed.
- **Login does not leak which emails have accounts**: one message and one timing
  profile for both failure modes, with a dummy bcrypt comparison on the
  no-such-user path.
- **Authorisation is never decided at the edge.** `src/proxy.ts` only checks that
  a cookie exists, so signed-out visitors do not load a shell they cannot use.
  The real decision is made in `requireAuth()`, which re-reads the membership and
  so honours a removed teammate, a suspended workspace or a changed role
  immediately.
- **A valid-but-unusable session is cleared before redirecting.** A suspended
  workspace used to bounce between `/dashboard` and `/login` forever, because the
  proxy saw a valid cookie while the database refused it. Those failures now go
  through `/api/auth/session-ended`, which clears the cookie first.
  `tests/auth-redirects.test.ts` guards it.

---

## Integrations

Every one is optional and independently switchable. JobFlow has to be useful to
an operator who has signed up for nothing but a database: the pipeline, CRM and
quoting all work with all of these unset.

### PostgreSQL

Use a **pooled** connection string in production (pgBouncer, Neon `-pooler`,
Supabase port 6543). Serverless runs many short-lived instances and an unpooled
URL exhausts the connection limit long before the app is busy. `DIRECT_URL` must
be unpooled — Prisma Migrate needs advisory locks a pooler cannot provide.

### Supabase (optional, as the database host)

1. Create a project at [supabase.com](https://supabase.com).
2. Settings → Database → Connection string:
   - `DATABASE_URL` — the **Connection pooling** string (port 6543), plus
     `?pgbouncer=true`
   - `DIRECT_URL` — the **direct** string (port 5432)
3. `npm run db:migrate:deploy`

### Stripe (billing)

1. Create four products in Stripe with recurring monthly prices: Starter $49,
   Pro $99, Business $199. (Free needs no product.)
2. Copy each **price** id (`price_…`, not `prod_…`) into `STRIPE_PRICE_STARTER`,
   `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`.
3. Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
4. Locally, forward webhooks and copy the signing secret it prints:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
5. In production, add the endpoint in the Stripe dashboard and copy its signing
   secret into `STRIPE_WEBHOOK_SECRET`.

`STRIPE_WEBHOOK_SECRET` is required whenever `STRIPE_SECRET_KEY` is set, and the
environment loader enforces that. An unverified webhook is an endpoint anyone can
POST to in order to grant themselves a subscription.

Plans and their limits are defined once, in `src/lib/billing/plans.ts`. The
pricing page, the billing screen and the usage guard all read that table.

### OpenAI (AI features)

```bash
AI_DRIVER="openai"
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-4o-mini"
```

Used for lead scoring, message drafting and the customer assistant. The
assistant is constrained: it will not quote a price that is not in your
configured pricing, promise availability without checking the calendar, or
invent a business policy.

### Google Maps (property analysis)

Enable **Maps JavaScript API** and **Geocoding API**, then create **two**
restricted keys:

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — browser. Visible in page source, so
  restrict it by HTTP referrer and give it only the Maps JavaScript API.
- `GOOGLE_MAPS_API_KEY` — server, for geocoding. Restrict by IP. Never exposed.

On measurement, honestly: satellite imagery does not give an exact lawn area.
`Property.measurementSource` records where a number came from, and anything not
measured by hand is labelled an estimate. A quote built on a guess presented as a
measurement loses money on the job.

### Twilio (SMS)

```bash
SMS_DRIVER="twilio"
TWILIO_ACCOUNT_SID="AC..."
TWILIO_AUTH_TOKEN="..."
TWILIO_PHONE_NUMBER="+15551234567"
```

The number must be SMS-capable and, for US traffic, 10DLC-registered — an
unregistered number gets filtered by the carriers rather than rejected, so
messages silently vanish.

### Resend (email)

```bash
EMAIL_DRIVER="resend"
RESEND_API_KEY="re_..."
EMAIL_FROM="JobFlow AI <hello@yourdomain.com>"
```

`EMAIL_FROM` must use a domain verified with Resend. With `EMAIL_DRIVER="none"`
messages are printed to the server console instead of sent, which is right for
local development and loud enough in production logs to be noticed.

---

## Local development

```bash
npm run dev              # dev server
npm run build            # production build
npm run start            # serve the production build
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm test                 # vitest
npm run db:studio        # browse the database
npm run db:migrate       # create and apply a migration
npm run db:migrate:deploy# apply existing migrations
```

`npm run build` does **not** require a database. The Prisma client is constructed
lazily behind a proxy (`src/lib/db/client.ts`) so a build compiles code rather
than connecting to services — otherwise the app could not compile on a host
before its production secrets were configured, which is the wrong order.

---

## Project structure

```
jobflow/
├── prisma/
│   ├── schema.prisma              27 models, the whole domain
│   └── migrations/                checked in, applied with migrate deploy
├── public/
├── src/
│   ├── app/
│   │   ├── (app)/                 signed-in shell; authorises in its layout
│   │   │   └── dashboard/
│   │   ├── (auth)/                login, signup, password reset, verification
│   │   ├── api/
│   │   │   ├── auth/              signup, login, logout, me, reset, verify
│   │   │   └── health/            liveness plus a real database round-trip
│   │   ├── legal/                 terms, privacy
│   │   ├── error.tsx              error boundary
│   │   ├── not-found.tsx
│   │   ├── globals.css            design tokens
│   │   ├── layout.tsx
│   │   └── page.tsx               landing page
│   ├── components/
│   │   ├── auth/                  sign-in, sign-up, reset, verify forms
│   │   ├── layout/                sidebar, bottom nav, top bar, nav map
│   │   ├── legal/
│   │   └── ui/                    Button, Card, Field, Alert, Badge,
│   │                              StatCard, EmptyState, Skeleton, Toast
│   ├── lib/
│   │   ├── analytics/summary.ts   dashboard figures, one parallel burst
│   │   ├── api/                   errors, handler, response, rate-limit
│   │   ├── auth/                  session, context, password, tokens, emails
│   │   ├── billing/plans.ts       plans and limits, defined once
│   │   ├── db/                    client + tenant isolation
│   │   ├── email/
│   │   ├── organizations/         workspace provisioning
│   │   ├── services/templates.ts  starter catalogue per trade
│   │   ├── validation/            zod schemas, shared with the forms
│   │   ├── dates.ts  money.ts  cn.ts  env.ts  api-client.ts
│   ├── proxy.ts                   optimistic route protection (Next 16)
│   └── types/
└── tests/                         vitest
```

### On shadcn/ui

The original spec named shadcn/ui. The UI primitives in `src/components/ui` are
hand-written in the same idiom — composable, unstyled-by-default, `className`
overridable via `tailwind-merge` — rather than generated by the shadcn CLI. Doing
it this way keeps Phase 1's dependency surface to zero Radix packages while the
component API stays compatible: `npx shadcn@latest add dialog` drops in
alongside these without conflict when a genuinely hard primitive (focus
trapping, popover positioning) is needed.

---

## Security

- **Multi-tenant isolation** enforced in the data layer, not per query
- **Authorisation re-read on every request**, so revocation is immediate
- **Revocable stateless sessions** via `sessionVersion`
- **bcrypt** at cost 12, with equalised timing on the no-such-user path
- **Every request body validated** with zod before it reaches the database,
  including stripping NUL bytes that would otherwise crash a Postgres query
- **Rate limiting** on login, signup, password reset, AI, messaging and the
  public quote endpoints (`src/lib/api/rate-limit.ts`)
- **Security headers** including a CSP scoped to Google Maps only; HSTS;
  `frame-ancestors 'none'` so a quote page cannot be framed and a customer
  tricked into clicking Accept
- **No stack traces to clients** — unexpected errors get a correlation id in the
  logs and a generic message in the response
- **Role-based permissions** via `requireRole()` on anything touching money,
  billing or membership
- **Open-redirect protection** on the post-login `next` parameter, and an
  allow-list on the sign-out banner so a query string cannot put attacker text
  above the password field
- **Webhook signature verification** required whenever Stripe is configured

To rotate all sessions at once, change `AUTH_SECRET` and redeploy.

---

## Testing

```bash
npm test
```

125 tests covering tenant isolation, session tokens and revocation, the
redirect-loop regression, money and margin arithmetic, request validation, plan
limits, rate limiting, workspace slugs and the service catalogue.

The most important file is `tests/tenant-isolation.test.ts`. Isolation is the one
property whose failure is unrecoverable — a customer list shown to the wrong
business cannot be un-shown — so it is tested per operation shape, including a
caller deliberately trying to override the tenant.

---

## Deployment (Vercel)

1. Push the repository.
2. **Import the project in Vercel and set the Root Directory to `jobflow`.**
   This app lives in a subdirectory; without that the build will not find it.
3. Add the environment variables from `.env.example`. At minimum:
   `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `APP_URL`.
   - `APP_URL` must be the real domain. Quote links, review links and password
     resets are absolute URLs built from it, and a background job has no request
     to infer a host from.
4. Deploy. The build runs `prisma generate && next build` and needs no database.
5. Apply migrations against production:
   ```bash
   DATABASE_URL="<direct, unpooled url>" npm run db:migrate:deploy
   ```
6. Add the Stripe webhook endpoint at `https://yourdomain.com/api/stripe/webhook`
   and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
7. Check `https://yourdomain.com/api/health` — it should report
   `{"status":"ok","database":"ok"}`.

### Other hosts

Nothing here is Vercel-specific. It needs a Node 22 runtime, the environment
variables, and `npm run db:migrate:deploy` run once per release. The only
platform assumption is that `x-forwarded-for` is set by a proxy you control,
which rate limiting relies on.

---

## Product principle

Every feature has to answer one of these:

- Does this help **capture** a lead?
- Does this help **close** a lead?
- Does this help **complete** a job?
- Does this help **get paid**?
- Does this help **bring the customer back**?

If not, it does not get built first.
