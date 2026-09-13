# Security review — JobFlow AI, end of Phase 14

Scope: the whole branch (`claude/jobflow-ai-saas-mvp-umfpby`), 44k lines across
46 API routes, the unauthenticated surfaces, and every library that touches the
database.

Four issues were found and **all four are fixed on this branch**. Each was
confirmed by running it, not by reading — against the real Postgres and, for the
redirect, in a real browser. Each fix was then re-run to confirm it closes.

| # | Issue | Severity | Category | Status |
|---|-------|----------|----------|--------|
| 1 | Membership queries were not tenant-scoped | High | tenant isolation | Fixed |
| 2 | "Is this user a teammate?" accepted a foreign user | Medium | authorization | Fixed |
| 3 | Caller-supplied foreign keys were never checked | Medium | tenant isolation | Fixed |
| 4 | Open redirect via `?next=` | Medium | open redirect | Fixed |

---

## Vuln 1: Tenant isolation — `src/lib/db/tenant.ts:53` (call site `src/app/(app)/jobs/[id]/page.tsx:45`)

* **Severity: High**
* **Category:** `tenant_isolation` / `data_exposure`

**Description.** `TENANT_MODELS` is the set of models the tenant client injects
`organizationId` into. `Membership` carries an `organizationId` but was missing
from that set, so the extension passed its queries through untouched. The job
detail page's "assign to" list was therefore filtered by nothing but
`status: 'ACTIVE'`.

The reason it survived review is worth recording: the guard test that was
supposed to catch exactly this listed the expected models *by hand*, so it was a
copy of the set rather than a check on it — and both the set and the test were
missing the same model.

**Exploit scenario.** Sign up for any workspace (or click "Try the demo", which
mints a session with no signup at all), create one customer and one job, open
`/jobs/<id>`. The rendered HTML carries the id and full name of every active
member of every business on the deployment. `STAFF` is sufficient; nothing is
guessed.

**Confirmed.** Against the dev database (120 organizations), a client scoped to
one organization returned **133 memberships, 132 of them belonging to other
organizations**.

**Fix.** `Membership` and `Subscription` added to `TENANT_MODELS`. The guard test
now derives the expected set from Prisma's DMMF, so any model added to
`schema.prisma` with an `organizationId` fails the build until it is scoped —
plus a canary case asserting the derivation itself found something, so the test
cannot pass over an empty list. Re-run after the fix: **1 membership, 0 foreign.**

---

## Vuln 2: Authorization — `src/lib/jobs/repository.ts:185` and `:282`

* **Severity: Medium**
* **Category:** `authz_bypass`

**Description.** Both `updateJob` and `scheduleJob` validated a caller-supplied
`assignedUserId` by looking for an active membership, under a comment stating
"The tenant client scopes memberships to this organization". Because of Vuln 1 it
did not. The check only proved the target user was an active member *somewhere*.

**Exploit scenario.** With a user id harvested via Vuln 1, `PATCH /api/jobs/<own
job>` with `{"assignedUserId":"<foreign user id>"}` succeeds, and the response
echoes the foreign user's name back through `JOB_SELECT`. It also works as an
oracle for "does this user id have an active membership anywhere".

**Confirmed.** The check, run verbatim against a foreign user id, returned a
match.

**Fix.** Closed by Vuln 1's fix — the lookup is now scoped by the extension,
which makes the existing comment true. Covered by the isolation test asserting
`organizationId` is injected into membership queries.

---

## Vuln 3: Tenant isolation — caller-supplied relation ids (`src/lib/db/ownership.ts`)

* **Severity: Medium**
* **Category:** `tenant_isolation` / `idor`

**Description.** The tenant extension rewrites the top-level `where`/`data` of
the model being queried. It cannot cover a foreign key written *into* your own
row, and it cannot filter a nested to-one relation read — Prisma's `include` for
a to-one relation accepts no `where`, so there is nowhere to add a filter even in
principle. Several write paths spread relation ids straight from the request body:

* `createLead` / `PATCH /api/leads/[id]` — `customerId`, `propertyId`
* `createQuote` — `propertyId` and each line item's `serviceId`
* `createJob` — `serviceId`, `propertyId`, `quoteId`
* `createAppointment` — `serviceId`
* `createReviewRequest` — `jobId`

`convertLead` already validated its `customerId`, which is what makes these
omissions inconsistencies rather than a deliberate model.

**Exploit scenario.** An employee removed from Business A — whose session is
correctly revoked — kept customer and property ids from URLs they visited while
employed. They sign up for their own free workspace and
`POST /api/leads` with `{"customerId":"<A's customer>","propertyId":"<A's
property>"}`, then `GET /api/leads/<new id>`: the response carries A's customer
name, email and phone, and the property's full street address. Persistent
unauthorized access after revocation. The `propertyId` on a quote is worse, since
the public quote page renders that address to anyone holding the link.

**Confirmed.** A lead created in one organization carrying another's
`customerId`/`propertyId` read back the victim's customer name and the property's
street address (`12 Oak Lane, Raleigh NC 27601`).

**Fix.** New `assertOwned()` helper looks each supplied id up *through the tenant
client*, where "does this row exist?" and "is it mine?" are the same question,
and reports a miss as "does not exist" rather than "belongs to someone else".
Applied at every write path above; the duplicate route-level checks in
`POST /api/quotes` were removed in favour of the one next to the write, so a
second caller inherits it. Re-run after the fix: foreign `customerId` and
`propertyId` both **refused**, an id from the caller's own workspace still
accepted.

A test asserts every module that can write one of these keys mentions
`assertOwned`, so a new repository function that takes a `customerId` from a body
and forgets the check fails the suite.

**Defence in depth, since added.** All 25 relations between tenant-owned models
now reference `(organizationId, id)` against a composite unique on the parent, so
a cross-tenant reference is a row Postgres refuses rather than one the
application has to remember to reject. `assertOwned` still runs first, because it
turns the same mistake into a clean 404 instead of a foreign-key error — but it
is no longer the only thing standing there.

Two things about that migration are worth knowing, both verified by running them:

* Prisma emits `ON DELETE SET NULL` across the whole key, which nulls
  `organizationId` too. Since that column is NOT NULL, deleting a customer fails
  outright — proved in Postgres before shipping it. The migration uses Postgres'
  column list (`ON DELETE SET NULL ("customerId")`), which clears only the
  reference; `prisma migrate diff` reports no drift against it. `prisma validate`
  warns about this on all 15 such relations, and that warning's advice must not be
  followed here; the note at the top of `schema.prisma` says why.
* A future `prisma migrate dev` that regenerates one of these constraints would
  drop the column list and silently break deletes, and nothing else in the
  toolchain notices. `npm run db:check-constraints` reads
  `pg_constraint.confdelsetcols` and also attempts one cross-tenant write inside a
  rolled-back transaction; CI runs it right after the migrations. Both halves were
  confirmed to fail against a deliberately sabotaged database.

---

## Vuln 4: Open redirect — `src/app/(auth)/login/page.tsx:23`

* **Severity: Medium**
* **Category:** `open_redirect`

**Description.** The `next` parameter was filtered with
`next.startsWith('/') && !next.startsWith('//')` and then handed to
`router.replace()` after a successful login. That reads as "a path, not a
protocol-relative URL", and it is wrong: a URL parser treats a backslash as a
slash for http(s), so `/\evil.com` satisfies both halves and resolves to
`https://evil.com/`.

**Exploit scenario.** A phishing mail contains a genuine link to the product's
own domain: `https://app.example.com/login?next=/%5Cevil.com`. The victim sees
the real login page on the real domain, enters real credentials, authenticates
successfully — and lands on an attacker-controlled clone showing "session
expired, please sign in again". The domain in the address bar at the moment of
the decision is ours.

**Confirmed in a browser.** Chromium, against the running app, with a real
account: after a successful login the router navigated to `http://evil.com/`.
(Every non-loopback request was aborted by an interceptor, so nothing external
was contacted.)

**Fix.** `safeReturnPath()` in `src/lib/auth/return-path.ts` stops
pattern-matching and asks the parser: the value is resolved against a sentinel
origin, and anything that lands elsewhere is rejected. Tests cover the
backslash forms, `//host`, absolute URLs, `javascript:` and `data:`, and
round-trip what the proxy actually writes so the two halves cannot drift apart.

---

## Also changed: password-reset links in production logs

Not one of the four, and below the reporting bar as a vulnerability, but cheap to
remove. With the default `EMAIL_DRIVER=none`, `logInsteadOfSending` printed the
full message body — including single-use password-reset links — to the server
console. In development that body *is* the point: there is no inbox, and the link
has to be clickable from the terminal. In production the same text is a
credential in a log stream that gets shipped, indexed and shared far more widely
than a mailbox. The body now prints outside production and is withheld inside it,
where the envelope still answers "is this app trying to send mail, and to whom?".

---

## Verified and found sound

Recorded so the next review need not re-derive it.

* **Sessions / JWT.** HS256 with a ≥32-character `AUTH_SECRET`,
  `algorithms: ['HS256']` pinned (no `none`, no algorithm confusion), issuer,
  audience and expiry all checked, `sub`/`org` type-checked, and a
  `sessionVersion` check against the database on every request. Cookie is
  `httpOnly`, `SameSite=Lax`, `Secure` in production.
* **Webhooks.** Stripe and Twilio verifiers both fail closed when the secret is
  unset, hash the raw body (never a re-serialized object), compare with
  `timingSafeEqual`, and Stripe enforces a ±300s timestamp tolerance plus a
  claim-before-work `WebhookEvent` idempotency gate. Plan attribution never
  trusts `metadata.tier`.
* **Unauthenticated routes.** `resolvePublicQuote` and `recordReviewClick` derive
  the tenant *from* a 128-bit random id rather than letting the caller name one;
  both shape-check the token before it reaches Postgres; drafts are hidden on
  both the page and the respond endpoint; `/r/[token]` re-validates the stored
  redirect target so it cannot become a `javascript:` gadget.
  `/api/cron/automations` refuses to run without `CRON_SECRET` and compares in
  constant time. `/api/demo` is off by default, and demo workspaces cannot reach
  a carrier or start a checkout.
* **Injection.** No `$queryRawUnsafe` or `$executeRaw` anywhere (the one raw
  statement is a parameterless `SELECT 1` health check). `renderTemplate` is
  named substitution against a fixed key allow-list with no evaluation. No
  `dangerouslySetInnerHTML`, no `eval`, no dynamic `href` reachable from user
  input. Ids and text go through Zod schemas that strip control characters and
  NUL.
* **Platform admin.** `requirePlatformAdmin` is the only door to `/admin`;
  `isPlatformAdmin` is not writable through any route or schema; the report
  returns aggregates and billing state, never tenant records. An ordinary owner
  gets a 404, not a 403 — covered by an end-to-end test.
* **Secrets.** `getPublicConfig()` exposes only `NEXT_PUBLIC_*` values and
  non-secret display fields. No server secret is passed into a client component.
  The public quote page receives only `publicId`, business name and status.
