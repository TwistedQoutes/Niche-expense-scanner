# Going live

Every account below is one you have to create yourself. Budget **90 minutes** the
first time, most of it waiting on DNS and Twilio.

Work top to bottom. Steps 1–4 get you a working product; 5–8 turn on the features
that cost money, and each one can be skipped and added later. That is a property
of the code, not a promise about the order: **every integration is independently
switchable and none of them gates the core.** With nothing but a database, leads,
the pipeline, customers, quotes, the public quote page, scheduling, jobs and
analytics all work. What you lose without each key is named in step 5 onward.

---

## Before you start

| What | Cost | Why |
| --- | --- | --- |
| A domain | ~$12/year | You are asking people for card details, and sending quote links by text. A `.vercel.app` address undermines both. |
| Vercel account | Free to start | Hosting, and the cron scheduler the automation worker needs. `netlify.toml` is committed too if you prefer Netlify — but Netlify has no equivalent of `vercel.json` crons, so you would schedule step 7 elsewhere. |
| Neon or Supabase | Free tier launches this | Postgres. Both are ordinary Postgres — nothing in the app is specific to either. |

You do **not** need Stripe, Twilio, Resend, OpenAI or Google Maps to get to a
working deployment. Skip to step 9 and come back.

---

## 1. The database

Create a Postgres database. You need **two** connection strings from it, and the
difference matters:

```bash
# Pooled. The application uses this at request time. On Neon it is the URL
# containing `-pooler`; on Supabase it is port 6543.
DATABASE_URL="postgresql://…-pooler…/jobflow?sslmode=require"

# Direct, unpooled. Migrations use this. On Neon, the same URL without
# `-pooler`; on Supabase, port 5432.
DIRECT_URL="postgresql://…/jobflow?sslmode=require"
```

Serverless runs many short-lived instances, and an unpooled URL exhausts a
managed Postgres' connection limit long before the app is busy — hence the pooled
one for requests. But `prisma migrate` takes advisory locks and runs DDL, and a
transaction pooler can carry neither: through the pooler a migration either hangs
or fails without mentioning pooling. Hence the direct one for migrations, which
`prisma.config.ts` uses whenever `DIRECT_URL` is set.

## 2. A session secret

```bash
openssl rand -base64 48
```

Set it as `AUTH_SECRET`. Rotating it signs everyone out, which is the intended way
to revoke every session at once after a compromise.

## 3. Deploy

1. Push the repository and import it in Vercel — this link opens the import with
   the repository already chosen:
   <https://vercel.com/new/import?s=https://github.com/TwistedQoutes/Niche-expense-scanner>

   Set the production branch to the one you want deployed (`main`). The app **is**
   the repository root, so leave Root Directory alone. (It lived in a `jobflow/` subdirectory
   until it was promoted — if an earlier deploy set that, clear it.)
2. Add `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, and:
   ```bash
   APP_URL="https://yourdomain.com"
   ```
   `APP_URL` must be your real domain. Quote links, review links and password
   resets are absolute URLs built from it, and a background job has no incoming
   request to infer a host from. Get this wrong and quote links point at the wrong
   place — or at `localhost`.
3. Deploy. The build runs `prisma generate && next build` and **never connects to
   the database**, so it succeeds before any of this is correct. That is
   deliberate: you cannot set production secrets on a deploy that has never built.

## 3a. Or let the script do 3 to 5

Steps 3 through 5 are mechanical, and mechanical steps done by hand are where
deployments go wrong — a migration run against the pooled URL, a secret pasted
with a trailing newline, `APP_URL` left pointing at localhost so every quote link
a customer receives goes nowhere. One command instead:

```bash
./scripts/deploy.sh \
  --database-url "postgresql://…-pooler…" \
  --direct-url   "postgresql://…direct…"
```

It applies the migrations against the direct URL, refuses to continue unless the
tenant boundary checks out, generates `AUTH_SECRET` and `CRON_SECRET` and hands
them to Vercel without printing them, deploys, then — because a first deploy
cannot know its own address — sets `APP_URL` to the URL Vercel just assigned and
deploys again. Pass `--app-url https://yourdomain.com` if you already have the
domain, and it skips that second pass. Re-running is safe.

`--database-only` stops after the migrations, which is what you want when you are
bringing a database up to date rather than shipping.

The rest of this document is the same work done by hand, and is what to read when
a step fails.

---

## 4. Create the schema

Against the **direct** URL, from your machine:

```bash
DIRECT_URL="<direct url>" npm run db:migrate:deploy
```

Then confirm the tenant boundary is intact in the database you just created:

```bash
DATABASE_URL="<direct url>" npm run db:check-constraints
```

That asserts all 25 relations between tenant-owned tables are composite foreign
keys, that each `ON DELETE SET NULL` still names only its own column, and — by
attempting one inside a transaction it rolls back — that Postgres refuses a
cross-tenant reference. It should print `Tenant constraints OK`. If it does not,
**stop**: multi-tenant isolation is the one property whose failure cannot be
undone after the fact.

You now have a working deployment. Sign up, and the rest is optional.

---

## 5. Email (Resend) — password resets

Without this, `EMAIL_DRIVER` stays `none` and every message is printed to the
server log instead of sent. Verification and password-reset emails never arrive,
so **nobody who forgets their password can get back in**. The body is withheld in
production (a reset link in a log stream is a credential), so you cannot recover
one by reading the logs either.

1. Create a Resend account and verify your sending domain — not just an address.
2. ```bash
   EMAIL_DRIVER="resend"
   RESEND_API_KEY="re_…"
   EMAIL_FROM="JobFlow AI <hello@yourdomain.com>"
   ```
   `EMAIL_FROM` must be on the verified domain or delivery fails.

## 6. SMS (Twilio) — follow-ups, missed-call text back, the inbox

Without this, nothing is texted: follow-up sequences, quote reminders, review
requests and missed-call replies are all still recorded and threaded in the inbox
as `QUEUED`, so the product visibly works, but no customer hears from you.

1. Buy an SMS-capable number. In the US, register it for **10DLC** — unregistered
   application-to-person traffic is filtered by carriers, and the failure looks
   like silence rather than an error.
2. ```bash
   SMS_DRIVER="twilio"
   TWILIO_ACCOUNT_SID="AC…"
   TWILIO_AUTH_TOKEN="…"
   TWILIO_PHONE_NUMBER="+15551234567"
   ```
3. In the number's settings, set **A message comes in** to
   `https://yourdomain.com/api/webhooks/twilio` (POST). Inbound replies land in
   the unified inbox, and a reply is what stops an automation sequence.
4. If you are behind a proxy or tunnel, also set `TWILIO_WEBHOOK_URL` to the exact
   URL you configured. Twilio signs **that URL**, so when the request's own host
   differs, every legitimate webhook fails verification.

## 7. The automation worker

Follow-up sequences, quote reminders, review requests and the reactivation sweep
all run from one endpoint. **Without `CRON_SECRET` it refuses to run at all** — an
unauthenticated endpoint that sends SMS on demand is someone else's marketing
budget spent from your account.

```bash
CRON_SECRET="$(openssl rand -hex 32)"
```

`vercel.json` already schedules both passes:

| Path | Schedule | What it does |
| --- | --- | --- |
| `/api/cron/automations` | every minute | Runs due automation steps. This cadence is the worst case for "how late can a follow-up be". |
| `/api/cron/automations?sweep=1` | `0 14 * * *` daily | Also runs the reactivation sweep and deletes expired demo workspaces. |

**Check what your Vercel plan allows before the first deploy.** Vercel's free
(Hobby) plan limits cron jobs to a small number, running once a day — a
minute-by-minute schedule is a paid feature, and on Hobby the committed
`vercel.json` will either be refused or quietly not run at that cadence, which
looks exactly like follow-ups being broken. Two ways out, both fine:

- Change the first schedule to something the plan allows (`0 * * * *` hourly, or
  `0 13 * * *` daily). A follow-up arrives later; nothing else changes.
- Leave `vercel.json` alone and schedule it somewhere else — any host with cron,
  GitHub Actions, or a service like cron-job.org — pointing at the same endpoint
  with the same bearer token. The endpoint does not care who calls it, only that
  the secret matches.

Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when that variable is set
on the project; the endpoint also accepts `x-cron-secret`, and compares in
constant time. Calling it by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://yourdomain.com/api/cron/automations
```

## 8. Billing (Stripe)

Leave `STRIPE_SECRET_KEY` unset to run without billing. Plan limits still apply —
they come from the subscription row in the database, not from Stripe — so an
unbilled deployment behaves as whatever plan you set on each workspace.

1. Create a **recurring monthly Product and Price** for each paid tier. The code's
   own figures are Starter **$49**, Pro **$99**, Business **$199** per month; if
   you charge differently, change `monthlyPriceCents` in `src/lib/billing/plans.ts`
   too, or the marketing page and the invoice will disagree.
2. Copy the **price** ids (`price_…`, not `prod_…`):
   ```bash
   STRIPE_SECRET_KEY="sk_live_…"
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_…"
   STRIPE_PRICE_STARTER="price_…"
   STRIPE_PRICE_PRO="price_…"
   STRIPE_PRICE_BUSINESS="price_…"
   ```
   An unknown price id is never guessed at: a webhook naming a price you have not
   configured leaves the plan alone rather than picking the nearest tier.
3. Add the webhook endpoint `https://yourdomain.com/api/stripe/webhook`,
   subscribed to exactly these events:

   ```
   checkout.session.completed
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   customer.subscription.paused
   customer.subscription.resumed
   invoice.paid
   invoice.payment_succeeded
   invoice.payment_failed
   invoice.finalized
   ```

4. Set the endpoint's signing secret:
   ```bash
   STRIPE_WEBHOOK_SECRET="whsec_…"
   ```
   **Required whenever `STRIPE_SECRET_KEY` is set.** The webhook is the only thing
   that grants a paid plan, so an unverified one is an endpoint anyone can use to
   subscribe themselves for free. It fails closed: with no secret configured,
   every webhook is rejected.

## 9. Optional extras

```bash
# Lead scoring and message drafting. Without it those features report that they
# are unavailable rather than guessing — and the quote calculator, which is the
# thing that actually prices work, never used AI in the first place.
AI_DRIVER="openai"
OPENAI_API_KEY="sk-…"

# Address suggestions as you type, and road distance for the travel line on a
# quote. Enable Geocoding API, Distance Matrix API and Places API, then restrict
# the key by IP. One key, never sent to the browser: the page asks our own
# /api/maps/autocomplete, which needs a session and is rate-limited per
# workspace. Unset, addresses are typed in full and mileage by hand.
GOOGLE_MAPS_API_KEY=""

# Days of full Pro access before a card is required. 0 disables the trial.
TRIAL_DAYS="14"
```

**`DEMO_MODE` stays `off` in production unless you want it.** On, any visitor can
create a seeded throwaway workspace with no account — an unauthenticated route
that writes to your real database. A demo workspace can never reach a carrier,
can never be subscribed to, and is deleted by the daily sweep, but it is still
rows in the database you are paying for.

---

## Smoke test

In order. Each step depends on the one before it, and the whole thing takes about
ten minutes.

- [ ] `curl https://yourdomain.com/api/health` returns `200`.
- [ ] Sign up. You land on the four-question setup wizard, not an error.
- [ ] Add a lead by hand. It appears at the **top** of the New column.
- [ ] Add a service with a price, then build a quote from that lead.
- [ ] Send the quote to **your own** phone or email.
- [ ] Open the quote link **in a private window**, signed out. The public page must
      render without a session — that is the whole point of it — and show your
      business name.
- [ ] Accept it. A job appears in the owner's Jobs list.
- [ ] Schedule the job, then mark it complete. Completion is the transition that
      must never apply twice.
- [ ] Ask for a review. Open the `/r/…` link and confirm it redirects to the review
      URL you set in Settings.
- [ ] Text a reply to your Twilio number. It appears in the inbox within seconds.
- [ ] Subscribe with a real card, then cancel in the billing portal. Check that
      Billing reflects both.
- [ ] **Isolation.** Sign up a second workspace in another browser profile, and try
      to open a URL from the first — `/customers/<id>`, `/quotes/<id>`. Every one
      must be a 404, not a 403 and not the record. This is the only item on this
      list whose failure cannot be fixed after the fact.

## When something is wrong

| Symptom | Cause |
| --- | --- |
| Quote links point at `localhost` | `APP_URL` is unset or wrong. |
| Nobody can reset a password | `EMAIL_DRIVER` is `none`, or `EMAIL_FROM` is not on the Resend-verified domain. The reset link is in no log — the body is withheld in production on purpose. |
| Messages stay `QUEUED` forever | `SMS_DRIVER` is `none`, or Twilio credentials are wrong. The message is threaded either way, which is why the inbox looks healthy. |
| Inbound texts never arrive | Twilio's webhook URL, or `TWILIO_WEBHOOK_URL` not matching the URL Twilio signs. |
| Follow-ups never send | `CRON_SECRET` unset (the endpoint refuses), or the Vercel cron is not firing. |
| A payment succeeds but the plan does not change | `STRIPE_WEBHOOK_SECRET` missing or wrong. Stripe's dashboard shows the delivery failures. |
| Migrations hang or fail oddly | Running against the pooled URL. Use `DIRECT_URL`. |
| `db:check-constraints` fails | A `prisma migrate dev` regenerated a foreign key and dropped its `SET NULL` column list. The error names the constraint; `prisma/schema.prisma` explains the repair. |

## Operating notes

- **Backups.** Neon and Supabase both do point-in-time recovery on paid tiers. The
  free tiers do not. You are storing other people's customer lists.
- **Rotating a secret.** `AUTH_SECRET` signs everyone out. Stripe and Twilio keys
  can be swapped with no user-visible effect. Changing `CRON_SECRET` requires
  updating it on the Vercel project too, or follow-ups silently stop.
- **Migrations on every deploy.** `npm run db:migrate:deploy` is not part of the
  build, deliberately — a build that migrates is a build that can destroy data on
  a rollback. Run it yourself, against `DIRECT_URL`, when a deploy includes one.
