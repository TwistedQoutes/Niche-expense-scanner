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

The build is phased. **Phases 1–8 are complete and verified**: project setup,
the full database schema, multi-tenancy, authentication, the dashboard shell,
the lead pipeline and CRM, the services catalogue and pricing engine,
professional quotes a customer can accept without an account, AI lead
qualification, and the messaging layer — a unified inbox, missed-call text-back,
carrier-compliant opt-out and the automated follow-up engine.

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Setup, Next.js, TypeScript, Tailwind, Prisma, Postgres, authentication | ✅ Done |
| 2 | Database schema, multi-tenancy, workspace provisioning | ✅ Done |
| 3 | Dashboard, navigation, UI components | ✅ Shell done |
| 4 | Customers, leads, CRM, Kanban pipeline | ✅ Done |
| 5 | Services, pricing engine, quote calculator | ✅ Done |
| 6 | Quote generation, public quote pages, acceptance | ✅ Done |
| 7 | AI lead qualification, AI responses | ✅ Done |
| 8 | Email/SMS, Twilio, Resend, automated follow-up | ✅ Done |
| 9 | Calendar, appointments, jobs | Next — jobs created on acceptance |
| 10 | Review requests, customer reactivation | Planned |
| 11 | Stripe billing, subscriptions, usage limits | Usage metering done |
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

## The pipeline

The board is the product's main screen, and two decisions in it are worth
stating.

**Two ways to move a card.** Dragging is what a board is for, and it works on a
desktop. But HTML5 drag-and-drop does nothing on touch, and these users are on a
phone in a truck more often than at a desk — so every card also carries a status
select. That is not a degraded fallback: on a phone it is the better
interaction, it is keyboard-operable, and a screen reader can drive it.

**Ordering is server-side.** A drag sends the two cards it was dropped between,
never a number. The server takes the midpoint of their positions, so a move is
one `UPDATE` rather than renumbering the column. Positions are spaced 65,536
apart, which allows sixteen consecutive drops into the same slot before the
integers between two neighbours run out; at that point the column is respaced
and the card is placed where the user actually pointed.

New leads go to the **top** of New, not the bottom. The whole product argument
is that response time decides who wins the job, so the newest enquiry has to be
the first thing an owner sees.

Converting a lead keeps it. The lead is the record of *how* a customer was won —
which source, how long it took — and the analytics funnel needs it. It gains a
`customerId` and moves to Won.

### Usage metering

Lead creation is metered against the plan's monthly allowance
(`src/lib/billing/usage.ts`). Counters are rows keyed on
(organization, metric, month), not `SELECT count(*)`: a FREE plan allows five
leads *per month*, and counting rows would quietly turn that into "five at a
time" the moment one is deleted. The month is the row key, so a period rolls
over without a scheduled job.

A past-due or cancelled subscription falls back to FREE rather than locking the
account. Locking someone out of their own customer list over a failed card turns
a billing problem into a cancellation.

---

## AI

New leads are scored automatically a second or two after they arrive: a number
out of 100, the job in one line, an urgency, a next action, and a draft reply.
That answers the only question an owner has at 7am with eleven enquiries waiting —
*which of these do I ring first?*

**Capturing a lead never depends on the AI working.** Qualification is
fire-and-forget: the lead is written and the response returns, then the score
follows. Verified live at 60ms for a create with AI off. A missed enquiry is the
failure this whole product is sold to prevent, so it cannot be made contingent on
a third party being up.

### The guardrails are code, not prompt

The system prompt asks the model not to quote prices, promise a time, or claim
the business is licensed. That is worth doing and it is **not a control**: a
prompt is a request, and the text it shapes is partly written by whoever filled
in a public intake form. So every rule is enforced again on the output, in
`src/lib/ai/guardrails.ts`, where it cannot be talked out of:

| Rule | Why |
| --- | --- |
| **No prices** | A price the model invents is a price the business is on the hook for. The only trustworthy number comes from the pricing engine, against rates the owner set. |
| **No time commitments** | Availability belongs to the calendar. A promised slot the calendar never agreed to is a missed appointment. |
| **No legal or safety claims** | "Guaranteed", "insured", "certified", "pet-safe" carry legal weight. They may be true of the business; they are not the model's to assert. |
| **No invented contact details** | A hallucinated phone number sends a customer to a stranger. |

Findings are **redacted, not rejected** — a draft with one phrase removed and a
warning attached is still useful; discarding a whole reply over four words is
not. Every redaction is recorded on the lead's activity trail, so an owner can
see later *that* something was removed.

Nothing the model writes is ever sent. The panel has a copy button and no send
button, deliberately: the person whose business name goes on the reply reads it
first.

### Other decisions

- **`temperature: 0`** and JSON mode. Scoring is classification, not creativity:
  the same lead has to score the same way twice or the number is not worth
  sorting by.
- **Every failure is bounded** — its own abort timeout and token ceiling, because
  a hung upstream call would otherwise hold a serverless invocation open until the
  platform kills it.
- **Three distinct outcomes**, mapped to real status codes: 403 when the plan's
  AI allowance is spent, **501** when this deployment has no key configured at
  all, 502 when the model itself failed. "Not configured" and "not allowed" would
  send an owner looking for a permission they do not need.
- **A missing score is `null`, not `0`.** "Not scored" and "scored zero" mean
  opposite things to someone deciding what to work on.
- **An unrecognised urgency becomes MEDIUM** — not EMERGENCY, which would cry
  wolf on every parse slip, and not LOW, which would bury a real emergency.
- **`OPENAI_BASE_URL` is configurable**, because "OpenAI-compatible" is a
  category now: Azure OpenAI, an egress proxy and a self-hosted gateway all speak
  this API at a different host.

With `AI_DRIVER=none` — the default — the lead page says so plainly and
everything else works unchanged.

---

## Quotes

A quote has two identities, and keeping them apart is the whole security story
of the public page:

- **`number`** (`Q-1001`) is for people. Sequential per business, because a
  customer ringing about "quote 1004" needs that to mean something.
- **`publicId`** is a credential. 128 random bits, because the quote page has no
  login — the id in the URL is the only thing between a customer's price and
  anyone who guesses a URL. A sequential public id would mean `/quote/1002`
  reveals the next business's quote.

`resolvePublicQuote` is the one place in the product where a tenant is chosen by
something a stranger sent. That is safe because the `publicId` *identifies*
exactly one organization rather than letting the caller pick one: the lookup runs
unscoped, and everything after it runs on a tenant client pinned to whatever
organization the quote turned out to belong to. Passing an organization id
alongside the quote id is the design that goes wrong, and `src/lib/quotes/public.ts`
says so, so nobody reintroduces it.

**A sent quote is immutable.** The customer has a copy of specific numbers;
changing them underneath would mean the price they accept is not the price they
were shown. Editing or deleting anything past DRAFT is refused, and a change
means a new quote. The whole calculation is frozen onto the row — inputs and
outputs — and line items copy the service's name and price rather than joining
to it, so next year's rate changes cannot rewrite last year's offer.

**Expiry is derived, never stored.** Nothing sweeps the table flipping rows to
EXPIRED, so a quote past its date still *says* SENT. If the accept path trusted
the stored status a customer could accept a three-month-old price, so every read
and every write asks `isExpired()` instead.

**Accepting is idempotent.** It settles the quote, creates the job, notifies the
business and moves the lead to Won — all at once, because a quote marked accepted
with no job behind it is a job nobody does. A double-tap on a phone, or a link
preview hitting the endpoint, returns the first outcome rather than producing a
second job. Verified live: three accepts, one job.

**A draft is not an offer.** Its `publicId` exists from creation, so the public
page and the respond endpoint both refuse anything still in DRAFT — otherwise a
link shared early would show a price the owner had not finished deciding on.

The page itself is `noindex, nofollow, nocache`: a quote URL is a credential, and
an indexed one is a leaked one. What it shows is an explicit allow-list of
business fields, not a `select` with a few columns removed — a public page is the
wrong place to discover that a column added next year was sensitive.

Delivery by email and SMS arrives with the messaging phase. Until then `send`
is honest about what it does: it opens the quote for a response and hands the
owner the link. A link an owner texts themselves is a working quote today.

---

## Pricing

`src/lib/pricing/engine.ts` is one pure function. No database, no clock, no
randomness — the same inputs always produce the same quote, which is what makes
a price defensible six months later when a customer asks how it was reached.

**A target margin is reached by division, not markup.** This is the single most
important line in the codebase. Adding 30% to a $100 cost gives $130, on which
the profit is $30 of $130 — a 23% margin. To actually keep 30% of the sale the
divisor is (1 − margin): 100 / 0.70 = $142.86. An operator who quotes the first
number and budgets for the second loses the difference on every job, and it is
the most common pricing mistake in the trades.

**Every step is emitted as a labelled line.** A total with no working is
something an owner cannot check, adjust, or explain to a customer standing next
to them. The calculator renders the whole derivation.

The order is: base charge → area → labour → materials → equipment → travel →
overhead → pricing rules → **estimated cost** → margin → minimum floor → fees →
discount → override → tax → **customer price**.

Decisions worth knowing:

- **Pricing rules add to cost, not to price.** If a steep slope or a winter
  callout makes a job harder, the extra effort should earn margin like every
  other hour. A surcharge on the price would give the hardest jobs the thinnest
  margin — exactly backwards.
- **Area rounds up.** A crew servicing 1,500 sq ft against a 1,000 sq ft unit
  does the whole extra pass, not half of one.
- **The minimum is a floor on the price, not on the discounted total.** A
  discount below the floor is a deliberate decision — a repeat customer, a
  goodwill gesture — so it is allowed and simply reported.
- **Sales tax is excluded from profit.** It was collected for the state and was
  never the business's money; counting it as revenue would overstate every
  margin on the dashboard.
- **The override is honoured exactly, and then audited.** The engine recomputes
  the achieved margin and warns when it falls short of target or goes below
  cost, so a deliberate discount is visible rather than silently eroding the
  number the business was built on.
- **A minimum below the base price is inert, not invalid.** The base is a cost
  component, so the margin price always clears it. Rejecting it as an error
  meant an owner could not edit a service that shipped with their own workspace.

The arithmetic runs on the server even though the engine is pure and could run
in the browser. Labour rates, margins and pricing rules are the most
commercially sensitive numbers a business has; shipping them to the client so a
form can do sums hands them to anyone who opens the network tab.

---

## Messaging and automations

A quote that gets no reply is the normal case, not the failure case. Most of the
money in this product is in what happens *after* the quote is sent, which is why
follow-up is an engine rather than a feature.

### A reply stops everything

The single most important behaviour: any inbound message from a person cancels
every automation aimed at them — not just the sequence they replied to. A
customer who answers and then receives "just checking in — any thoughts?" two
days later has been told plainly that nobody is reading. `cancelRunsForCustomer`
sweeps runs whose subject is that customer, their lead, their quotes or their
jobs, and the cancellation is the first thing the inbound handler does.

### Opt-out is matched on the whole message

`STOP` is honoured; "please stop by on Tuesday" is not. Substring matching would
silently unsubscribe a customer who wanted the opposite, so the message is
stripped of punctuation and compared in full against the carrier keywords. The
opt-out is stored as a tag on the customer and checked before every send,
including automated ones. The confirmation is sent directly rather than through
`sendMessage`, which would correctly refuse to text a number that has just opted
out.

### Templates cannot leak their own syntax

`renderTemplate` has a fallback for every placeholder it knows — `{{first_name}}`
becomes "there" rather than nothing — and strips any placeholder it cannot fill,
tidying the punctuation left behind. A customer receiving a literal
`{{first_name}}` is the most visible bug this product could ship, so it is not
possible to reach the carrier with one.

### The worker is a queue, not a cron of side effects

`AutomationRun` rows *are* the queue. `/api/cron/automations` claims each due run
with a conditional `updateMany` on `status: PENDING`, which is the lock — two
overlapping invocations cannot both take the same run, and the platform is free to
retry the HTTP call. One step runs per pass, failures are isolated per run, and
three attempts with 5- and 25-minute backoff separate a provider outage from a
genuinely bad message.

An opt-out or a spent plan allowance is **not** recorded as a failure: refusing to
send is the system working. Only the provider failing is a failure.

The endpoint refuses with 501 when `CRON_SECRET` is unset, rather than running
unauthenticated. `vercel.json` runs it every minute; that cadence sets the worst-case
latency for a delayed step, not for the missed-call text, which is sent inline (see
below).

### Missed calls

A missed call becomes a lead and a text back within seconds, which is the whole
argument: a homeowner rings three companies and hires whoever answers. The lead
is created even if the text fails, because knowing somebody rang is worth more
than the text. `completed` is deliberately excluded from the missed-call statuses —
texting "sorry we missed your call" to someone the owner just spoke to is worse
than saying nothing.

The text itself is an automation rather than hard-coded, so an owner can edit its
wording or turn it off.

**It is sent during the webhook call, not on the next scheduled pass.** Queuing a
zero-delay step and waiting for the cron would make "within seconds" mean "within
the next minute", which is comfortably long enough for a competitor to have
answered. Doing it inline on Twilio's request path is safe because every step of
it is idempotent: the run is claimed with the same conditional update the
scheduled worker uses, so the two cannot both send it; and if the request is slow
enough for Twilio to time out and retry, the retry creates no second lead — the
caller is a known one by then — and fires no second trigger. If the inline attempt
throws, the lead is kept and the run stays `PENDING` for the scheduled pass to
collect.

### Inbound webhooks are verified before they are believed

`/api/webhooks/twilio` is otherwise an endpoint where anyone on the internet can
put words in a customer's mouth: inject messages into a business's inbox, create
leads, and — because STOP is honoured — unsubscribe that business's customers
from their own follow-ups. So:

- The HMAC-SHA1 signature is checked **before any database access**, against the
  URL Twilio signed (`TWILIO_WEBHOOK_URL`, since a proxy or tunnel rewrites the
  host) and the parameters concatenated Twilio's way — `a=1&b=2` becomes `a1b2`,
  with no separators.
- Verification **fails closed**. No auth token configured means every webhook is
  rejected, because the alternative turns a missing environment variable into an
  open endpoint.
- Comparison is constant-time.
- Rejections return 204 and explain nothing. Twilio retries non-2xx, and retrying
  a request we deliberately refused only multiplies the noise; a prober learns
  nothing either way.
- A number **no** business claims is dropped rather than attributed to a guess.
- A number **two** businesses claim is also dropped. Picking the first match —
  the oldest row, as it happens — would file a stranger's text in whichever
  workspace signed up first, which is one tenant reading another tenant's
  customer. Nothing in the request says whose customer it is, so nothing is
  guessed; the collision is logged for an operator instead.

`tests/messaging.test.ts` checks the signature implementation against Twilio's own
documented example rather than against our reading of their algorithm.

### Costs are visible before they are incurred

Every outbound text is metered against the plan allowance, and the reply box
counts characters against a 480-character ceiling. A long message is split into
segments and billed per segment, so the owner is told before they send rather
than on their invoice.

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

### Leads and customers

| Operation | Route |
| --- | --- |
| List leads (filter, search, paginate) | `GET /api/leads` |
| Create a lead | `POST /api/leads` |
| Read one lead with its timeline | `GET /api/leads/[id]` |
| Update a lead | `PATCH /api/leads/[id]` |
| Delete a lead (ADMIN) | `DELETE /api/leads/[id]` |
| Move a card on the board | `PATCH /api/leads/[id]/move` |
| Add a timeline note | `POST /api/leads/[id]/notes` |
| Convert to a customer | `POST /api/leads/[id]/convert` |
| List customers | `GET /api/customers` |
| Create a customer | `POST /api/customers` |
| Read one customer with full history | `GET /api/customers/[id]` |
| Update a customer | `PATCH /api/customers/[id]` |
| Delete a customer (ADMIN) | `DELETE /api/customers/[id]` |

### Services and pricing

| Operation | Route |
| --- | --- |
| List services | `GET /api/services` |
| Create a service (ADMIN) | `POST /api/services` |
| Update a service (ADMIN) | `PATCH /api/services/[id]` |
| Delete a service (ADMIN) | `DELETE /api/services/[id]` |
| List pricing rules | `GET /api/pricing-rules` |
| Create a rule (ADMIN) | `POST /api/pricing-rules` |
| Update a rule (ADMIN) | `PATCH /api/pricing-rules/[id]` |
| Delete a rule (ADMIN) | `DELETE /api/pricing-rules/[id]` |
| Change workspace defaults (ADMIN) | `PATCH /api/pricing/defaults` |
| Price a job without saving it | `POST /api/pricing/calculate` |

### Quotes

| Operation | Route |
| --- | --- |
| List quotes | `GET /api/quotes` |
| Create a draft | `POST /api/quotes` |
| Read one quote | `GET /api/quotes/[id]` |
| Edit a draft | `PATCH /api/quotes/[id]` |
| Delete a draft | `DELETE /api/quotes/[id]` |
| Open it for a response | `POST /api/quotes/[id]/send` |

### Public — no session

| Operation | Route |
| --- | --- |
| The customer's quote page | `GET /quote/[publicId]` |
| Record that it was opened | `POST /api/public/quotes/[publicId]/view` |
| Accept, decline, ask for changes | `POST /api/public/quotes/[publicId]/respond` |

### AI

| Operation | Route |
| --- | --- |
| Score a lead and draft a reply | `POST /api/ai/qualify` |

### Messaging and automations

| Operation | Route |
| --- | --- |
| Reply in a thread | `POST /api/conversations/[id]/messages` |
| Enable or disable an automation | `PATCH /api/automations/[id]` |

### Machine callers — no session

| Operation | Route |
| --- | --- |
| Inbound texts and call status | `POST /api/webhooks/twilio` |
| Run due automation steps | `POST /api/cron/automations` |

Neither takes a cookie. The webhook authenticates with Twilio's signature; the
cron endpoint with a bearer `CRON_SECRET` compared in constant time, and returns
501 rather than running when that is unset.

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

For inbound texts and missed calls, point the number's webhooks at
`https://yourdomain.com/api/webhooks/twilio` (both "A message comes in" and
"A call comes in" / status callback), and set:

```bash
TWILIO_WEBHOOK_URL="https://yourdomain.com/api/webhooks/twilio"
```

That is the URL the signature is verified against. It exists because Twilio signs
the URL *it* was configured to call, which behind a proxy, a tunnel or a platform
that rewrites the host is not the URL the request appears to arrive at — and
verifying against the wrong string rejects every legitimate webhook. It defaults
to `APP_URL` + the path, which is correct when no proxy rewrites anything.

Inbound is resolved to a workspace by the business's own stored phone number, so
each workspace needs a distinct one under Settings. Two workspaces sharing a
number makes their inbound traffic unattributable, and it is then dropped rather
than guessed at.

With `SMS_DRIVER="none"` texts are printed to the server console instead of sent.
That is the default, and it matters more here than anywhere else: every message
costs money at the carrier, so a bug that sends a hundred texts should be a log,
not a bill.

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
│   │   │   ├── customers/         list and full CRM detail
│   │   │   ├── dashboard/
│   │   │   ├── automations/       follow-up sequences, on and off
│   │   │   ├── leads/             pipeline board, new, detail
│   │   │   ├── messages/          unified inbox, thread with manual reply
│   │   │   ├── pricing-settings/  defaults, catalogue, rules, calculator
│   │   │   └── quotes/            list and detail
│   │   ├── (auth)/                login, signup, password reset, verification
│   │   ├── api/
│   │   │   ├── ai/                qualify a lead
│   │   │   ├── auth/              signup, login, logout, me, reset, verify
│   │   │   ├── automations/       enable and disable a sequence
│   │   │   ├── conversations/     manual reply into a thread
│   │   │   ├── cron/              the automation worker, bearer-authenticated
│   │   │   ├── customers/         list, create, read, update, delete
│   │   │   ├── health/            liveness plus a real database round-trip
│   │   │   ├── leads/             list, create, move, convert, notes
│   │   │   ├── pricing/           defaults, calculate
│   │   │   ├── pricing-rules/     list, create, update, delete
│   │   │   ├── public/            unauthenticated quote view and response
│   │   │   ├── quotes/            list, create, read, update, send
│   │   │   ├── services/          list, create, update, delete
│   │   │   └── webhooks/twilio/   inbound texts and call status
│   │   ├── legal/                 terms, privacy
│   │   ├── quote/[publicId]/      the customer's quote page — no session
│   │   ├── error.tsx              error boundary
│   │   ├── not-found.tsx
│   │   ├── globals.css            design tokens
│   │   ├── layout.tsx
│   │   └── page.tsx               landing page
│   ├── components/
│   │   ├── auth/                  sign-in, sign-up, reset, verify forms
│   │   ├── automations/           the on/off switch and what it warns about
│   │   ├── layout/                sidebar, bottom nav, top bar, nav map
│   │   ├── leads/                 pipeline board, card, actions, AI panel
│   │   ├── messaging/             reply box with a segment-cost counter
│   │   ├── pricing/               defaults form, service editor, calculator
│   │   ├── quotes/                send panel, customer response, quote-from-lead
│   │   ├── legal/
│   │   └── ui/                    Button, Card, Field, Alert, Badge,
│   │                              StatCard, EmptyState, Skeleton, Toast
│   ├── lib/
│   │   ├── ai/                    client, guardrails, qualification
│   │   ├── analytics/summary.ts   dashboard figures, one parallel burst
│   │   ├── api/                   errors, handler, response, rate-limit
│   │   ├── automations/           triggers, cancellation, the queue worker
│   │   ├── auth/                  session, context, password, tokens, emails
│   │   ├── billing/               plans and limits, usage metering
│   │   ├── customers/repository.ts CRM reads and rollups
│   │   ├── db/                    client + tenant isolation
│   │   ├── leads/                 pipeline definition, ordering, repository
│   │   ├── messaging/             send, inbound, opt-out, templates
│   │   ├── pricing/               the pure calculation, and input resolution
│   │   ├── quotes/                numbering, public scope, lifecycle
│   │   ├── email/
│   │   ├── organizations/         workspace provisioning
│   │   ├── services/templates.ts  starter catalogue per trade
│   │   ├── sms/                   Twilio driver and signature verification
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
- **Webhook signature verification** required whenever Stripe or Twilio is
  configured, checked before any database access and **failing closed** when the
  secret is absent, so a missing environment variable cannot turn an endpoint into
  an open one
- **Inbound messages are attributed or dropped, never guessed.** A number that
  matches no workspace, or more than one, is refused: filing a stranger's text in
  an arbitrary workspace would be one tenant reading another tenant's customer
- **Carrier opt-out is honoured before every send**, automated sends included, and
  matched on the whole message so "please stop by on Tuesday" is not an
  unsubscribe
- **The automation worker authenticates its caller** with a constant-time bearer
  comparison, and refuses to run at all until `CRON_SECRET` is set

To rotate all sessions at once, change `AUTH_SECRET` and redeploy.

---

## Testing

```bash
npm test
```

329 tests covering tenant isolation, session tokens and revocation, the
redirect-loop regression, the AI guardrails and their false-positive behaviour,
AI absence and bounded failure, quote expiry and response gating, public-id
entropy, document numbering under a race, the pricing engine (including the
specification's own worked example, margin-versus-markup, rules, floors, tax and
overrides), pipeline ordering and respacing, Twilio signature verification,
carrier opt-out keywords, template rendering, inbound number resolution, plan
resolution, money arithmetic, request validation, plan limits, rate limiting,
workspace slugs and the service catalogue.

The most important file is `tests/tenant-isolation.test.ts`. Isolation is the one
property whose failure is unrecoverable — a customer list shown to the wrong
business cannot be un-shown — so it is tested per operation shape, including a
caller deliberately trying to override the tenant.

`tests/messaging.test.ts` is next. Two of the things it covers cannot be
apologised for afterwards: a forged webhook, and a missed opt-out. The signature
tests run against Twilio's own documented example — token, URL, parameters and
expected signature — so they check the implementation against their algorithm
rather than against our reading of it.

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
7. Set `CRON_SECRET` to a long random value to turn on automated follow-ups.
   `vercel.json` schedules `/api/cron/automations`; the endpoint returns 501 while
   the secret is unset, so follow-ups stay off until you deliberately enable them
   rather than starting to text customers on first deploy.
8. Check `https://yourdomain.com/api/health` — it should report
   `{"status":"ok","database":"ok"}`.

### Other hosts

Nothing here is Vercel-specific. It needs a Node 22 runtime, the environment
variables, and `npm run db:migrate:deploy` run once per release. The only
platform assumption is that `x-forwarded-for` is set by a proxy you control,
which rate limiting relies on.

`vercel.json` only supplies the *schedule*. Elsewhere, have anything that can make
an HTTP request call `POST /api/cron/automations` every few minutes with
`Authorization: Bearer $CRON_SECRET`. Overlapping calls are safe — each due run is
claimed with a conditional update — so a platform that retries or double-fires
cannot send a follow-up twice.

---

## Product principle

Every feature has to answer one of these:

- Does this help **capture** a lead?
- Does this help **close** a lead?
- Does this help **complete** a job?
- Does this help **get paid**?
- Does this help **bring the customer back**?

If not, it does not get built first.
