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

The build is phased. **Phases 1–14 are complete and verified**: project setup,
the full database schema, multi-tenancy, authentication, the dashboard shell,
the lead pipeline and CRM, the services catalogue and pricing engine,
professional quotes a customer can accept without an account, AI lead
qualification, the messaging layer — a unified inbox, missed-call text-back,
carrier-compliant opt-out and the automated follow-up engine — scheduling with
jobs and a calendar in the business's own timezone, and the repeat-business
loop: tracked review requests, reactivation of lapsed customers, and the
settings screen the rest of it depends on, and Stripe billing — hosted checkout,
a signature-verified webhook, and plan limits that follow what the workspace has
actually paid for, analytics with a platform admin view for whoever runs JobFlow
itself, and the way in: a four-question setup wizard and a seeded demo workspace
that cannot touch the real world.

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
| 9 | Calendar, appointments, jobs | ✅ Done |
| 10 | Review requests, customer reactivation | ✅ Done |
| 11 | Stripe billing, subscriptions, usage limits | ✅ Done |
| 12 | Analytics, admin dashboard | ✅ Done |
| 13 | Landing page, onboarding, demo mode | ✅ Done |
| 14 | Testing, security, performance, deployment | ✅ Done |

The navigation in `src/components/layout/navigation.ts` is the whole product map,
with a `built` flag per entry. Unbuilt screens are hidden rather than shown as
dead links, and each phase flips its entries on as it lands.

### What is not built

Named here rather than left to be discovered: `loadSpeed` and `monthlySeries`
still aggregate in JavaScript what Postgres could aggregate in SQL. The reasoning
for leaving that alone is in `docs/performance-phase-14.md`.

---

## Requirements

- **Node.js 22.12+** (`node --version`)
- **PostgreSQL 15+** — local, or a managed host (Neon, Supabase, Railway, RDS).
  Not 14: the tenant migration uses `ON DELETE SET NULL ("column")`, whose
  column-list form arrived in 15, and without it deleting a customer fails
  outright. On 14 the migration does not apply at all.
- npm 10+

Nothing else is required to run the app. Every third-party integration is
optional; see [Integrations](#integrations).

---

## Installation

```bash
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

## Scheduling

### A crew's 9am is a wall-clock time

The one thing that decides whether a calendar is usable. A booking arrives as a
**date plus a time of day** — `2026-07-15` and `09:00` — and the server converts
it using the organization's own timezone. It never accepts an instant from the
browser, because a phone set to another zone would then shift the booking, and
`new Date('2026-07-15T09:00')` on a serverless host resolves against UTC — putting
a 9am visit on the calendar at 5am local, which the crew discovers on the day.

The conversion (`wallClockToInstant`) cannot just look the offset up, because
which offset applies depends on the instant being computed. It guesses from the
offset at the naive time, re-checks the offset at that answer, and then keeps only
the candidates that survive their own offset. That last test is what separates the
two days a year when a wall-clock time is not a single instant:

- **The clocks go forward.** 2:30am does not exist that morning. Neither candidate
  is self-consistent, so the later one is taken: the instant the clock jumps to.
  Half past two becomes half past three, which is what a person booking that
  morning means. Taking the earlier candidate would move the job *backwards*, to
  before the time they asked for.
- **The clocks go back.** 1:30am happens twice, and both candidates are real. The
  earlier is returned, as every calendar application does.

A business day is therefore not 24 hours: `localDayRange` produces 23 or 25 on
those two days. A fixed 24-hour window would drop an hour of appointments off one
end, or pull tomorrow's first job onto today's list.

`tests/scheduling-time.test.ts` round-trips every hour across a DST boundary and
checks both edge cases, a zone with no daylight saving, a zone on the other side
of UTC, and a non-hour offset (`Asia/Kathmandu`, +05:45).

The timezone is set under **Settings**, and `isValidTimeZone` rejects a name the
runtime does not know — a bad value would throw inside `Intl` on every calendar
render, taking the page down rather than showing the wrong hour.

### Double-booking is refused once, then allowed

Bookings are half-open intervals `[startsAt, endsAt)`. That is the only convention
under which a crew can work 9–10 and then 10–11: treating them as closed would
report a full morning as five double-bookings.

A clash does not silently go through, and it is not simply blocked either. The
first attempt is refused with a message naming what it collided with, and the
owner can repeat the request with `allowConflict`. Two crews with a van each is a
real arrangement; only the owner knows whether this is that or a mistake.

Who is busy matters more than what is booked. When a booking names a person, only
that person's visits count as clashes; when it does not, the slot itself is being
reserved and everything in it counts.

The overlap test exists in two places — the SQL range query that narrows the
candidates, and the predicate applied to the rows that come back — so a test pins
them together over every arrangement of two intervals. Duplicated logic like that
is exactly what drifts.

### Completion is the one write that must not happen twice

Finishing a job moves the customer's lifetime value and completed count, sets the
next-service date, and fires the review request. Those are *increments*: applying
them twice is not a display glitch but a wrong number in the owner's books that
nothing later corrects.

So the transition is a conditional `updateMany` on the status the caller read. The
first call matches and applies the rollups; a second matches nothing, changes
nothing, and returns `changed: false` so the UI can stay quiet rather than claiming
the job was just completed again. Completed and cancelled are terminal — there is
no path back out of them that would re-fire any of it.

The final price is asked for at completion rather than taken from the quote. A lawn
that turned out to be twice the size was a different job from the one priced, and
lifetime value has to reflect what was charged.

### Booking a job writes the job and its visit together

A job that says Tuesday while its appointment says Wednesday is an inconsistency
the crew discovers at a customer's gate. Scheduling therefore stamps
`scheduledFor` and creates — or *moves* — the one appointment, rather than
accumulating a row per reschedule. Cancelling a job cancels its visit, putting the
slot back on the calendar, and stops any follow-up aimed at it.

Appointments are cancelled, never deleted. The slot has to be freed, but "there was
a visit here and it was called off" is what an owner needs when a customer asks why
nobody came.

---

## Repeat business

Two features, one argument: the cheapest job to win is one from somebody who has
already paid you. Reviews win the next stranger; reactivation wins the same
person again.

### The review link is the one value that goes to every customer

A business types it into Settings and the product texts it to everyone it ever
works for, so it is validated harder than any other field — parsed rather than
pattern-matched, and checked for the two things a regex over `\S+` waves through:

- **Only http and https.** A `javascript:` URL in a link a customer taps from a
  text message is script execution, not navigation.
- **No embedded credentials.** `https://www.google.com@evil.example` reads as
  Google to anyone skimming and resolves to evil.example.

This is not mainly about a malicious owner. It is about a link pasted from
somewhere odd, and about bounding what a compromised admin session could turn the
business's own review texts into.

The same check runs again at redirect time. A stored value can predate a rule or
be written by hand, and the redirect is the moment it becomes a link a real
customer follows — so that is where it is enforced, not only on the way in.

### `/r/{token}` is a tracked link, and an unauthenticated one

The customer has no account and no session; the token *is* the credential, and it
identifies one review request and through it one organization — the same argument
as the public quote page. So it is 128 bits of randomness, shape-checked before it
reaches the database, and rate limited because it is a public endpoint that writes.

An unknown token, a malformed one, and one whose stored link no longer passes
validation all get the same answer: a redirect to the marketing page, with nothing
said about which case it was. Someone walking the token space learns nothing, and
a bad stored value is never reflected back — so it cannot become a redirect
gadget. The response is a 303 (the request had a side effect) and carries
`X-Robots-Tag: noindex`.

Only the **first** tap is recorded. A customer who opens the link twice, or whose
mail client prefetches it, has not changed their mind twice, and overwriting
`clickedAt` would lose when they actually engaged.

### Reactivation has to be able to happen twice

`fireTrigger` is idempotent per (automation, subject) via a unique index, which is
exactly right for a quote follow-up and exactly wrong for a seasonal reminder: the
row outlives the run that created it, so a customer could be reactivated once in
the lifetime of the workspace and never again.

So reactivation passes `rearmFinishedRuns`, which re-arms a run that has
**finished** and never one still in flight — restarting a chase already under way
would text somebody twice. The row is reused rather than a second one inserted,
which keeps the unique index and therefore the idempotency intact; the messages
themselves stay in the conversation, which is the real record of what the customer
received.

Firing also pushes `nextServiceDueAt` a full window forward. Without that, a
customer whose sequence finished while they were still overdue would be chased
again on the very next pass, forever.

A customer with no completed job is **new, not lapsed**. Chasing them as a former
customer reads as a mistake, and it is the first thing a real customer list would
expose.

### The sweep runs daily, not minutely

Who counts as lapsed changes by the day. `/api/cron/automations?sweep=1` is a
second, slower schedule in `vercel.json`, and it only looks at workspaces with the
reactivation automation actually enabled — so a business that has never turned it
on costs nothing rather than one query per pass to throw the answer away. One
workspace's bad data cannot stop another's sweep.

### When it cannot work, it says so

A review request with no link configured is skipped rather than sent with a dead
link — a customer who tried and landed nowhere is worse than no ask at all. But
silence looks like a broken feature, so the Reviews screen and Settings both say
what is missing, and asking by hand refuses with the reason instead of a silent
no-op. The automated path stays quiet; a person who pressed a button gets an
answer.

---

## Billing

### The webhook is the only thing that grants a paid plan

Which makes it the highest-value endpoint in the product to forge. A fabricated
`customer.subscription.updated` is a free Business plan; a fabricated
`customer.subscription.deleted` downgrades a paying customer out of spite. So:

- **The signature is checked over the raw bytes.** `request.text()`, never
  `request.json()` — re-serialising changes key order and whitespace, the signature
  is over what Stripe sent, and an implementation that re-serialises fails on every
  legitimate webhook. The usual "fix" for that is to stop verifying.
- **Verification fails closed.** No signing secret configured means every webhook
  is rejected, because the alternative turns a missing environment variable into a
  way to grant yourself a paid plan.
- **The timestamp is enforced** with Stripe's five-minute tolerance, in both
  directions. Without it a captured signature stays valid forever and a payment
  event can be replayed as often as you like; accepting future timestamps would
  have the same effect.
- **Every `v1` value is compared**, in constant time. Stripe sends more than one
  during a secret rotation, and reading only the first breaks every webhook for the
  length of the rollover.

`tests/stripe-verify.test.ts` builds signatures the way Stripe documents and checks
each of those cases, including that a re-serialised body is rejected — the test that
documents why the route reads raw bytes.

### Replay is handled twice, deliberately

The timestamp tolerance stops a captured request being reused. Separately, every
processed event id is recorded, because Stripe legitimately retries any delivery
that does not return 2xx — and applying a payment event twice is not a display bug.

The event row is written **before** the work, not after. A concurrent duplicate
then loses the insert and returns early, rather than both deliveries passing a
"have we seen this?" check and both applying the event. If the work afterwards
throws, the claim is released, because an event marked handled that never was leaves
a workspace on the wrong plan with no retry coming.

### An unknown price is never guessed at

A webhook names a price, and that decides which plan's limits the workspace gets.
An unrecognised one leaves the plan exactly as it was and logs loudly. Every
fallback is worse: defaulting to the top tier hands out Business on a configuration
mistake, defaulting to FREE downgrades a paying customer because an environment
variable was missing, and trusting the tier in the event's own metadata lets anyone
who can create a subscription pick their own plan.

### A webhook may only change the workspace it names

The organization is resolved from metadata we set at checkout, confirmed against a
real row, with the Stripe customer id as a fallback for a subscription created by
hand in Stripe's dashboard. An event that cannot be attributed is logged and
dropped — applying it to an arbitrary workspace would change the wrong customer's
plan.

`stripeCustomerId` and `stripeSubscriptionId` are unique across the whole table, so
writing one another workspace already holds raises a constraint violation. Left
unhandled that is a 500, and Stripe retries a failing delivery for days before
disabling the endpoint — so one collision would break every subsequent event for
that workspace. The collision is detected first: the identifier is **not claimed**,
the plan and status are still applied, and the clash is logged for a person to
resolve. Not claimed rather than moved, because silently reassigning it would move
the billing relationship with it.

### A failed payment must not lock anybody out

`effectivePlan` drops a past-due, unpaid or cancelled workspace to FREE limits and
nothing else. No data is deleted, no screen is taken away, and the plan they had
stays on the record. Locking someone out of their own customer list over a failed
card is how a billing problem becomes a cancellation.

Refusals say which it is. A workspace nominally on Pro and effectively on Free is
not told "your plan does not include text messages" — that reads as wrong to
somebody who is paying. It is told the payment failed and where to fix it.

### Cards are Stripe's problem

Checkout and the billing portal are both hosted. No card detail is ever typed into
this product, which keeps the whole application out of PCI scope. Cancellation
lives in the portal too, where the customer can see exactly what it means and when
it takes effect.

Checkout is **OWNER only** — it commits the business to a recurring charge — and
the organization comes from the verified session, never from the request, so a
caller cannot buy a plan for another workspace. Every mutating Stripe call carries
an idempotency key, so a double-clicked upgrade button is one subscription rather
than two. Any trial still running is passed to Stripe, so entering a card early
does not cost the customer the days they were promised.

---

## Analytics

### The charts are server-rendered SVG, and the colour was computed

No chart library and no client JavaScript: the plot is SVG, the numbers come from
the same tenant-scoped client as everything else, and the page works with scripting
off.

The palette was not chosen by eye. The emerald ramp was run through a validator
against **this app's own surfaces** — white in light, slate-900 in dark — and the
steps that ship are the ones that passed:

- **One accent for single-series charts** (`#059669` light, `#0ba573` dark), each
  inside its mode's lightness band and over 3:1 against its surface.
- **An ordinal ramp for the funnel**, one hue getting darker down the stages, with
  a visible lightness gap between each. The light ramp starts at the lightest step
  that still clears 2:1 on white; the dark ramp stops at the darkest that clears
  2:1 on slate-900. A stage that fades into the card is a stage nobody reads.

Dark is *selected*, not flipped: a step that reads well on white is either
invisible or glaring on near-black, so the two modes are separately stepped from
the same ramp and separately validated.

### The encoding follows the data's job

- **Funnel stages are ordered**, so they get the ordinal ramp. Five different hues
  would spend the identity channel on information the bar lengths already carry.
- **Lead sources are not ordered** — they are just names — so every bar is the same
  colour. Shading each one darker-where-bigger would double-encode length as hue
  and imply a ranking that does not exist.
- **A single series gets no legend.** The heading says what is plotted; a
  one-swatch box would only restate it.
- **One value is labelled directly**, on the endpoint. A number on every point is
  chaos and goes unread; the axis and the table carry the rest.

Text never wears a data colour. Identity comes from a swatch beside the label,
because these ramp steps are unreadable as type.

### Axis labels are HTML, not SVG text

Text inside a `viewBox` scales with it, so an 11px label on a 720-unit plot renders
at about 5px once the card is phone width — present, and unreadable. The SVG holds
the plot; the type sits outside it and stays the size it was written at.

The months are labelled counting **back** from the newest, so the current month —
the one carrying the direct label — always gets an axis label. Counting forwards
drops it on an even-length series, which is exactly the month a reader is looking
for.

### Every chart has a table

Not a fallback — the guarantee. `Show the numbers` under each trend carries every
plotted value, so nothing is reachable only through colour: not for a screen
reader, not in a printout, and not for the one reader in twelve the hues do not
work for.

### The figures are honest about what they are

- **The funnel counts cumulative reach**, not "currently sitting in this stage". A
  completed job still counts as having been quoted — otherwise the funnel appears
  to empty as the business succeeds.
- **Speed is a median, not a mean**, and the screen says so. One quote that sat
  unanswered for three months drags an average past the point of being useful.
- **A month with no activity still appears, at zero.** A trend that silently skips
  the quiet months makes a seasonal business look like it grew when it only stopped
  reporting.
- **A delta against a period that had nothing is omitted, not shown as 0%.**

---

## Platform admin

`/admin` is for whoever runs JobFlow, not for the businesses on it. Three things
keep it that way:

- **`requirePlatformAdmin()` is the only door**, and it answers a signed-in
  customer with a **404**, not a 403 — the surface is not advertised to somebody
  who cannot use it. The nav entry is hidden by the same flag rather than shown and
  refused.
- **It reads aggregates and billing state only.** That a workspace exists, what it
  pays, whether it is active, and how many leads and jobs it has. There is no route
  from it into anybody's leads, customers or messages — running the platform does
  not require reading its customers' mail. The page says so out loud, and a live
  test asserts that no customer or lead name appears on it.
- **MRR is computed from list prices**, so a discount or promotion code is not
  reflected. It is a health indicator, not an accounting figure — Stripe is the
  authority on money, and a number in an admin panel that looks like revenue but
  disagrees with the payment processor is worse than no number. The screen says
  that too.

---

## Getting started, and the demo

### Four questions, and Skip is always there

Trade, timezone, what you charge, where customers leave reviews. The wizard writes
the same fields Settings does — it is a guided path through them, not a separate
store — so a skipped question is a field to fill in later, never a broken
workspace.

Which is why **Skip is on every step**. A setup flow that will not let you past is
how a product loses the customer it just acquired, and none of these answers is
unanswerable tomorrow. Finishing is idempotent and keeps the *first* timestamp:
walking the wizard again to change a trade should not rewrite when the business
started.

Changing trade replaces the starter catalogue **only while nothing has been done
with it**. Once a service has been renamed, repriced or used on a quote it is the
owner's work; somebody who picked "lawn care" by mistake on Tuesday and fixes it on
Friday must not lose Wednesday's pricing. The wizard says which happened rather
than appearing to do nothing.

### A demo that cannot text a stranger

`DEMO_MODE=on` lets a visitor open a seeded workspace with no account. It is off by
default, because it is an unauthenticated route that writes to the real database.

**A fresh workspace per visitor**, never one shared sandbox: a shared demo is a
place where one visitor's typing is the next visitor's first impression, and where
anything typed in — which will include real names and real phone numbers, because
people test with their own — is visible to strangers.

The risk worth naming is precise. A prospect edits a fake customer, puts their own
number in, and clicks send. Four things stand in the way:

1. **`sendMessage` refuses to hand anything from a demo workspace to a carrier.**
   Checked there rather than at each call site, for the same reason the opt-out is:
   a new caller cannot forget it. The message is still written to the thread, so
   the product visibly works — but as `QUEUED`, never `SENT`, because nothing was.
2. **Every seeded contact is fictional by construction** — the 555 exchange
   reserved for fiction, and `example.test`, which can never be registered. Belt to
   the braces above.
3. **Checkout refuses a demo**, before it even checks whether Stripe is
   configured — a guard that only applies on deployments with billing keys set is
   a guard a configuration change can switch off.
4. **The daily sweep deletes demos past `DEMO_TTL_HOURS`**, and its queries carry
   `isDemo: true` every time, never built up dynamically. The throwaway account
   goes with it, matched on a `.invalid` domain and only when it is left with no
   workspace — a real person invited into a demo must not be swept up.

The banner says all of it out loud: made up, nothing sent, gone within a day.

### The landing page reads its flags at request time

It is deliberately **not** statically prerendered, and that is a trade rather than
an oversight. A static page inlines `process.env` at build time, so a deployment
that switched `DEMO_MODE` on afterwards would keep serving a page with no demo
button until somebody happened to redeploy, with nothing to indicate why. Reading
it at request time costs one cheap server render — no database, no session, no
third-party call — and the property that actually mattered survives: the page that
sells the product still does not depend on the product.

---

## Team

A workspace starts as one person and grows by invitation. Three rules carry the
weight, and all three live in `src/lib/team/repository.ts`:

**You can only act on someone you outrank.** `outranks()` is the whole privilege
model: strictly below, never at your own level. Two consequences are the point
rather than side effects — an admin cannot invite or remove another admin, so one
compromised admin account cannot quietly reshape who else has access; and nobody
can act on themselves, which is what stops an owner demoting the only account that
could undo it. Inviting a role goes through the same check as removing a person
holding it, because minting an admin when you are an admin is privilege escalation
with extra steps.

`OWNER` is not in the invite schema at all. Ownership is transferred, not handed
out from a form, and the rank check would refuse it anyway — leaving it out means
the API says "that is not a role you can invite" rather than "you are not
allowed".

**A seat is a seat whether or not it has been taken.** Pending invitations count
against the plan (Free 1, Starter 2, Pro 5, Business unlimited — `seatLimitFor`).
Otherwise the limit is a suggestion: send five invitations on a two-seat plan and
the third person through the door is the one who finds out. Withdrawing an
invitation frees its seat again.

**Accepting happens without a session,** so it cannot use a tenant client. The
organization comes *out of* the token's row, never from anything the caller sends —
the same shape as the public quote page. An invitation is 256 bits of randomness,
stored only as a SHA-256 hash, single-use through a conditional update rather than
a read followed by a write, and expires after seven days.

### An invitation is addressed to an email, not a user

Deliberately not an `AuthToken`. Those hang off a `userId`, and the person being
invited may not exist yet — `users.passwordHash` is NOT NULL, so issuing one
through `AuthToken` would mean creating an account that cannot log in and has to be
swept up if the invitation is never accepted. A `pending invitation` is one row
with nothing else attached to it.

If the address already has an account, accepting attaches the membership and then
sends them to sign in. Attaching it on the strength of the emailed token is fine;
*using* it has to be done by whoever can actually sign in as them.

### Withdrawing, suspending, restoring

Suspended rather than deleted, and that is the choice: the person stops being able
to sign in on their very next request — `requireAuth` re-reads the membership every
time and refuses anything but `ACTIVE` — while the jobs they completed keep pointing
at a real name. Deleting the membership would leave the history attributed to
nobody, and "who did this job?" is a question a business gets asked months later.

### When email is not configured

Inviting still works, and the link comes back to the inviter to pass on by hand.
The first version of this refused instead, which was worse in both directions: it
left the feature dead on any deployment that had not set up Resend yet, and it was
untestable in a production build, which is what `next start` and therefore CI is.
It is also what half of small operators will do regardless of what we email. The
link is returned only when the email did *not* go out, so a token sitting in an
inbox is not also sitting in a response body.

---

## Maps

Two server-side calls, both optional, and one deliberate refusal.

### It does not measure your lawn

Satellite imagery can be made to produce an area figure, and that figure is a
guess with a confident number attached: it cannot tell a lawn from a gravel drive,
cannot see under a tree, and is months stale. Quoting from it means quoting a price
the crew then argues about on the doorstep. `Property.lawnAreaSqFt` carries a
`measurementSource` beside it for exactly this reason, and nothing automated ever
sets either — an area on a property was measured by a person, or it is not there.

### What it does instead

**Address suggestions.** The property address field on a new lead, and the
business address in Settings, suggest as you type: pick one and the city, state
and ZIP underneath fill themselves in. Those are the three fields that get
mistyped, and a wrong ZIP is a crew at the wrong end of town.

It is proxied, not embedded. The usual approach loads Google's Places library in
the page with a `NEXT_PUBLIC_` key, which publishes a key anyone can lift and
spend. Here the browser posts to `/api/maps/autocomplete`, which requires a
session and is rate-limited per workspace before it calls Google — so the key
stays on the server, no third-party script runs on a page showing customer
records, and there is something between a stuck key and a bill. Suggestions and
the final lookup share a Google session token, so an address costs one session
rather than one charge per keystroke; typing is debounced for the same reason.

The field is a real combobox — arrow keys, Enter, Escape, announced options —
and without a Maps key it is an ordinary text input that behaves exactly as it
did before. Nothing about the form depends on the lookup working.

**Geocoding.** Converting a won lead turns its address into coordinates and a
place id, stored on the property. That is the one moment the address is known and
somebody is already waiting. A failure returns null and the property saves without
them: an address a human can read is still an address, and refusing to convert a
won lead because a third party was slow would be the tail wagging the dog.

**Drive distance.** The quote calculator's per-mile rule needs a number, and
mileage is the one input an owner genuinely cannot eyeball. `POST
/api/pricing/travel` measures road distance from the business address — a river or
a junction is the difference between a ten-minute hop and a forty-minute detour, so
straight-line distance would be charging for geometry rather than for fuel and
time. Rounded to whole miles and minutes, because "12 miles" invites less argument
than "11.83".

It runs **only on a press**. Each call is billed, and an owner opening the
calculator to look at a price should not spend money. The result is returned, not
saved: mileage belongs to the quote it was calculated for, and a figure frozen onto
a property would go stale while looking authoritative.

### Failure is the normal case

Every unhappy path — no match, a timeout, over quota, a refused key — returns null,
because to the caller they are the same thing: carry on without it. The one that
bites is Google answering **HTTP 200 with the failure inside the body**
(`ZERO_RESULTS`, `OVER_QUERY_LIMIT`, `REQUEST_DENIED`), which anything checking
only `response.ok` reads as success. `tests/maps.test.ts` covers each of those
shapes against a stubbed fetch.

With no key set, the Measure button is not rendered and mileage is typed by hand,
exactly as before.

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

### Jobs and the calendar

| Operation | Route |
| --- | --- |
| List jobs, filtered by status | `GET /api/jobs` |
| Create a job with no quote behind it | `POST /api/jobs` |
| Read or edit one job | `GET` / `PATCH /api/jobs/[id]` |
| Put it on the calendar | `POST /api/jobs/[id]/schedule` |
| Start, complete or cancel it | `POST /api/jobs/[id]/status` |
| The calendar for a day or a week | `GET /api/appointments` |
| Book a visit with no job | `POST /api/appointments` |
| Reschedule or call off a visit | `PATCH` / `DELETE /api/appointments/[id]` |

`/api/jobs/[id]/status` names the action in the body rather than the URL, so a
crew member's tap cannot be replayed out of a browser history. Scheduling takes a
date and a time of day, never an instant — see [Scheduling](#scheduling).

### Setup and the demo

| Operation | Route |
| --- | --- |
| Save one wizard step | `POST /api/onboarding` |
| Start a seeded demo — no account | `POST /api/demo` |

The demo route is the only unauthenticated write in the product besides the intake
form, so it is off unless `DEMO_MODE=on`, rate limited to three an hour per
address, and everything it creates is fictional and temporary.

### Reviews and settings

| Operation | Route |
| --- | --- |
| Review requests and their stats | `GET /api/reviews` |
| Ask one customer for a review | `POST /api/reviews` |
| The business's own details | `PATCH /api/settings` |

### Billing

| Operation | Route |
| --- | --- |
| Start a hosted checkout | `POST /api/billing/checkout` |
| Open Stripe's billing portal | `POST /api/billing/portal` |

Analytics and the platform admin view are pages rather than API routes — both are
server-rendered and read through the same tenant-scoped client as every other
screen, so there is no separate reporting endpoint to secure.

Both are OWNER only, and both take the organization from the verified session
rather than the body — so a caller cannot buy a plan for, or manage the billing
of, another workspace.

### Machine callers — no session

| Operation | Route |
| --- | --- |
| Inbound texts and call status | `POST /api/webhooks/twilio` |
| Subscriptions, invoices and payments | `POST /api/stripe/webhook` |
| Run due automation steps | `POST /api/cron/automations` |
| Also sweep for lapsed customers | `POST /api/cron/automations?sweep=1` |
| A customer tapping a review link | `GET /r/[token]` |

None of these takes a cookie. The webhook authenticates with Twilio's signature;
the cron endpoint with a bearer `CRON_SECRET` compared in constant time, and
returns 501 rather than running when that is unset; `/r/[token]` is authenticated
by the token itself — see [Repeat business](#repeat-business).

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

```bash
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_STARTER="price_..."
STRIPE_PRICE_PRO="price_..."
STRIPE_PRICE_BUSINESS="price_..."
```

Create one recurring monthly price per paid tier in Stripe and put its id in the
matching variable. A tier with no price configured simply cannot be bought, and the
API says so rather than failing at Stripe.

Add the webhook endpoint at `https://yourdomain.com/api/stripe/webhook` and
subscribe it to `checkout.session.completed`, `customer.subscription.*`,
`invoice.paid` and `invoice.payment_failed`. Its signing secret goes in
`STRIPE_WEBHOOK_SECRET` — without it **every webhook is rejected**, which is
deliberate: see [Billing](#billing).

With no Stripe keys at all, plans and limits still work and usage is still metered;
there is simply nothing to buy, and the billing screen says so.

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

### Google Maps (addresses and drive distance)

Enable **Geocoding API**, **Distance Matrix API** and **Places API**, then create
**one** key, restricted by IP:

```bash
GOOGLE_MAPS_API_KEY="…"
```

One key, and it is a server key. The usual way to do address autocomplete is to
load Google's Places library in the page with a `NEXT_PUBLIC_` key, which means
publishing a key that anyone can lift from page source and spend — HTTP referrer
restrictions are a speed bump, not a lock. Instead the browser asks
`/api/maps/autocomplete`, which requires a session, is rate-limited per
workspace, and calls Google from the server. Nothing about Maps reaches the
browser, and no third-party script runs on a page showing customer records.

Suggestions and the final lookup share a Google session token, so typing an
address is billed as one session rather than one charge per keystroke.

Unset the key and everything still works: the address field becomes an ordinary
text input and the drive-distance button is hidden.

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

### Reviews (no integration needed)

Review requests need no third-party service — just the link customers should leave
a review on, pasted into **Settings**. For Google that is the short link from the
business profile's "Ask for reviews" panel; Yelp, Facebook and Angi links work the
same way. Requests are skipped, not sent, while it is unset.

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
├── prisma/
│   ├── schema.prisma              27 models, the whole domain
│   └── migrations/                checked in, applied with migrate deploy
├── public/
├── src/
│   ├── app/
│   │   ├── (app)/                 signed-in shell; authorises in its layout
│   │   │   ├── customers/         list and full CRM detail
│   │   │   ├── dashboard/
│   │   │   ├── admin/             every workspace — platform admins only
│   │   │   ├── analytics/         trend, funnel, sources, speed
│   │   │   ├── automations/       follow-up sequences, on and off
│   │   │   ├── billing/           plan, usage this month, invoices
│   │   │   ├── onboarding/        the four-question setup wizard
│   │   │   ├── calendar/          day and week, in the business's timezone
│   │   │   ├── jobs/              list by status, and one job's whole life
│   │   │   ├── leads/             pipeline board, new, detail
│   │   │   ├── messages/          unified inbox, thread with manual reply
│   │   │   ├── pricing-settings/  defaults, catalogue, rules, calculator
│   │   │   ├── quotes/            list and detail
│   │   │   ├── reviews/           requests, and who is worth getting back
│   │   │   └── settings/          business details, timezone, review link
│   │   ├── (auth)/                login, signup, password reset, verification
│   │   ├── api/
│   │   │   ├── ai/                qualify a lead
│   │   │   ├── appointments/      the calendar, and visits without a job
│   │   │   ├── auth/              signup, login, logout, me, reset, verify
│   │   │   ├── automations/       enable and disable a sequence
│   │   │   ├── billing/           hosted checkout and the Stripe portal
│   │   │   ├── conversations/     manual reply into a thread
│   │   │   ├── demo/              start a seeded throwaway workspace
│   │   │   ├── cron/              the automation worker, bearer-authenticated
│   │   │   ├── customers/         list, create, read, update, delete
│   │   │   ├── health/            liveness plus a real database round-trip
│   │   │   ├── jobs/              create, edit, schedule, start, complete
│   │   │   ├── leads/             list, create, move, convert, notes
│   │   │   ├── onboarding/        one wizard step at a time
│   │   │   ├── pricing/           defaults, calculate
│   │   │   ├── pricing-rules/     list, create, update, delete
│   │   │   ├── public/            unauthenticated quote view and response
│   │   │   ├── quotes/            list, create, read, update, send
│   │   │   ├── reviews/           list, and ask one customer
│   │   │   ├── services/          list, create, update, delete
│   │   │   ├── team/              invite, roles, suspend and restore
│   │   │   ├── settings/          the business's own details
│   │   │   ├── stripe/            the billing webhook
│   │   │   └── webhooks/twilio/   inbound texts and call status
│   │   ├── legal/                 terms, privacy
│   │   ├── quote/[publicId]/      the customer's quote page — no session
│   │   ├── r/[token]/             the tracked review link — no session
│   │   ├── error.tsx              error boundary
│   │   ├── not-found.tsx
│   │   ├── globals.css            design tokens
│   │   ├── layout.tsx
│   │   └── page.tsx               landing page
│   ├── components/
│   │   ├── auth/                  sign-in, sign-up, reset, verify forms
│   │   ├── automations/           the on/off switch and what it warns about
│   │   ├── billing/               plan actions, usage bars
│   │   ├── charts/                validated palette, trend, funnel, bar list
│   │   ├── marketing/             the landing page's demo button
│   │   ├── jobs/                  schedule form, status actions, tones
│   │   ├── layout/                sidebar, bottom nav, top bar, nav map, demo banner
│   │   ├── leads/                 pipeline board, card, actions, AI panel
│   │   ├── messaging/             reply box with a segment-cost counter
│   │   ├── reviews/               the ask-for-a-review button
│   │   ├── settings/              business details form
│   │   ├── pricing/               defaults form, service editor, calculator
│   │   ├── quotes/                send panel, customer response, quote-from-lead
│   │   ├── legal/
│   │   └── ui/                    Button, Card, Field, Alert, Badge,
│   │                              StatCard, EmptyState, Skeleton, Toast
│   ├── lib/
│   │   ├── ai/                    client, guardrails, qualification
│   │   ├── analytics/             dashboard summary, reports, platform totals
│   │   ├── api/                   errors, handler, response, rate-limit
│   │   ├── automations/           triggers, cancellation, the queue worker
│   │   ├── jobs/repository.ts     job lifecycle and the completion rollups
│   │   ├── auth/                  session, context, password, tokens, emails
│   │   ├── billing/               plans and limits, usage metering
│   │   ├── customers/repository.ts CRM reads and rollups
│   │   ├── db/                    client + tenant isolation
│   │   ├── leads/                 pipeline definition, ordering, repository
│   │   ├── messaging/             send, inbound, opt-out, templates
│   │   ├── pricing/               the pure calculation, and input resolution
│   │   ├── quotes/                numbering, public scope, lifecycle
│   │   ├── demo/seed.ts           the data a demo opens with, and its cleanup
│   │   ├── onboarding/            the wizard's steps and catalogue switching
│   │   ├── reviews/               requests, tracked clicks, reactivation
│   │   ├── stripe/                client, signature checks, subscription state
│   │   ├── email/
│   │   ├── organizations/         workspace provisioning
│   │   ├── scheduling/            overlap rules, appointments, the calendar
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
- **Assigning a job checks membership, not just the user row.** A user from another
  workspace exists; assigning them would both leak that and put a job in a
  stranger's queue
- **Revenue is incremented under a conditional update**, so a job completed twice
  is counted once
- **A link the product will send to customers is parsed, not pattern-matched** —
  http and https only, no embedded credentials — and re-checked at redirect time
  rather than trusted because it passed validation when it was saved
- **A tracked review link never reflects its stored target back** on failure, so a
  bad value cannot become a redirect gadget; unknown, malformed and unsafe all get
  the same answer
- **Stripe's signature is verified over the raw request bytes**, with a timestamp
  tolerance so a captured request cannot be replayed, and every rotation signature
  compared in constant time
- **Every Stripe event id is recorded before the work**, so a retried delivery
  cannot credit a payment twice
- **A webhook can only change the workspace it names**, and an unrecognised price
  never moves a plan in either direction
- **No card detail is handled by this product** — checkout and the portal are both
  Stripe-hosted, which keeps the application out of PCI scope
- **Buying a plan is OWNER only**, and the workspace comes from the session rather
  than the request
- **The platform admin surface answers a customer with a 404**, not a 403, and its
  nav entry is hidden rather than shown and refused
- **Platform admin reads aggregates and billing only** — no route from it into any
  business's leads, customers or messages
- **A demo workspace can never reach a carrier**, enforced inside `sendMessage` so
  no call site can forget it, and its seeded contacts are fictional by
  construction
- **A demo cannot be subscribed to**, checked before billing configuration so the
  guard cannot be switched off by unrelated settings
- **Demo cleanup is scoped to `isDemo` on every query**, and deletes only
  throwaway accounts left with no workspace

To rotate all sessions at once, change `AUTH_SECRET` and redeploy.

---

## Testing

```bash
npm test
```

555 tests covering tenant isolation, session tokens and revocation, the
redirect-loop regression, the AI guardrails and their false-positive behaviour,
AI absence and bounded failure, quote expiry and response gating, public-id
entropy, document numbering under a race, the pricing engine (including the
specification's own worked example, margin-versus-markup, rules, floors, tax and
overrides), pipeline ordering and respacing, Twilio signature verification,
carrier opt-out keywords, template rendering, inbound number resolution,
timezone-aware booking across daylight-saving boundaries, appointment overlap,
job state transitions, review-link and redirect-target safety, review token
entropy, Stripe signature verification and replay windows, subscription status
mapping, plan resolution after a billing failure, chart month bucketing and the
validated palette contract, the onboarding steps' refusal to count an empty body as
an answer, the demo's fictional contact ranges, money arithmetic, request
validation, plan limits, rate limiting, workspace slugs and the service
catalogue.

The most important file is `tests/tenant-isolation.test.ts`. Isolation is the one
property whose failure is unrecoverable — a customer list shown to the wrong
business cannot be un-shown — so it is tested per operation shape, including a
caller deliberately trying to override the tenant.

`tests/messaging.test.ts` is next. Two of the things it covers cannot be
apologised for afterwards: a forged webhook, and a missed opt-out. The signature
tests run against Twilio's own documented example — token, URL, parameters and
expected signature — so they check the implementation against their algorithm
rather than against our reading of it.

`tests/scheduling-time.test.ts` earns its place for a duller reason: an hour is a
small error that produces a crew at the wrong house, and the only way to be sure is
to round-trip every hour across the two days a year the arithmetic is hard.

### End to end

```bash
npm run test:e2e
```

28 tests, run twice — once as a desktop browser and once as a phone, because this
product is used one-handed in a truck and a layout that only works at 1280px does
not work. They drive a production build against a real Postgres: signup and the
pipeline, tenant isolation through real cookies, a stranger accepting a quote,
team invites, address autocomplete, billing, the automation worker and the
missed-call path.

The last three are the ones a unit test cannot reach, because each is a
conversation with somebody else's server:

- **Billing.** A stub Stripe runs on loopback and the app talks to it through its
  real client — `STRIPE_BASE_URL` exists for this — so a checkout is a real
  round trip. Webhooks are signed by the spec with the secret the server holds:
  a forged one is refused and changes nothing, a signed one grants the plan, a
  redelivery of an event already handled is *not* applied a second time, and a
  cancellation drops the workspace to the free ceiling, which then refuses the
  sixth lead of the month by name and number.
- **The automation worker.** The scheduler's endpoint refuses every request
  without the shared secret. With it, a quote that goes out is followed up once
  — and a second pass does not text the same person twice.
- **The missed-call path.** An unsigned webhook does nothing at all: no lead, no
  text, no thread. A signed one puts the call on the board and texts back on the
  webhook's own request rather than on the next scheduled pass. An answered call
  is left alone, a reply stops every sequence aimed at that person, and STOP is
  acknowledged exactly once.

Nothing leaves a test run. `SMS_DRIVER` and `EMAIL_DRIVER` are `none`, so a sent
message is recorded as QUEUED and asserted on there; Stripe is the loopback stub;
the Maps key only makes the address field a combobox, and that spec intercepts the
app's own endpoint in the browser. Every secret the suite signs with is a
placeholder in `tests/e2e/environment.ts`, read both by the specs and by the
server `playwright.config.ts` starts — one copy, because a webhook signed with a
different secret than the server holds fails as a 400 that looks like a real bug.

---

## Deployment (Vercel)

**[DEPLOYMENT.md](DEPLOYMENT.md) is the full going-live checklist** — every
account to create, what each integration turns on, what breaks without it, and a
smoke test to run afterwards. What follows is the short version.

1. Push the repository.
2. Import the project in Vercel. The app is the repository root, so the default
   Root Directory is correct — leave it alone. (It lived in a `jobflow/`
   subdirectory until it was promoted; if you set that Root Directory on an
   earlier deploy, clear it.)
3. Add the environment variables from `.env.example`. At minimum:
   `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `APP_URL`.
   - `APP_URL` must be the real domain. Quote links, review links and password
     resets are absolute URLs built from it, and a background job has no request
     to infer a host from.
4. Deploy. The build runs `prisma generate && next build` and needs no database.
5. Apply migrations against production, using the **direct** connection. A
   transaction pooler cannot carry the advisory locks and DDL a migration needs,
   and fails without saying so; `prisma.config.ts` uses `DIRECT_URL` when it is
   set, precisely so this is not a thing you have to remember:
   ```bash
   DIRECT_URL="<direct, unpooled url>" npm run db:migrate:deploy
   ```
   Then confirm the tenant boundary survived the migration:
   ```bash
   DATABASE_URL="<direct, unpooled url>" npm run db:check-constraints
   ```
6. Add the Stripe webhook endpoint at `https://yourdomain.com/api/stripe/webhook`,
   subscribed to `checkout.session.completed`, `customer.subscription.*`,
   `invoice.paid` and `invoice.payment_failed`, and put its signing secret in
   `STRIPE_WEBHOOK_SECRET`. Without that secret every webhook is rejected, so a
   plan would never activate — check Stripe's own delivery log if one does not.
7. Set `CRON_SECRET` to a long random value to turn on automated follow-ups.
   `vercel.json` schedules `/api/cron/automations` minutely and
   `/api/cron/automations?sweep=1` once a day for the reactivation sweep; the
   endpoint returns 501 while the secret is unset, so follow-ups stay off until you
   deliberately enable them rather than starting to text customers on first deploy.
8. Optionally set `DEMO_MODE="on"` to offer a no-account demo from the landing
   page. It is off by default; everything a demo creates is fictional, cannot be
   messaged or billed, and is deleted by the daily sweep after `DEMO_TTL_HOURS`.
9. Check `https://yourdomain.com/api/health` — it should report
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
