# Going live

Everything in this file is an account you have to create yourself — I cannot do
these parts for you. Budget **90 minutes** the first time.

Work top to bottom; each step depends on the one before it.

---

## Before you start

| What | Cost | Why |
| --- | --- | --- |
| A domain | ~$12/year | You are asking people for card details. A `.vercel.app` address undermines that. |
| Vercel account | Free to start | Hosting. |
| Neon or Supabase account | Free tier is enough to launch | Postgres. |
| Stripe account | 2.9% + 30¢ per charge | Payments. |
| Resend account | Free to 3,000 emails/month | Password resets. |

---

## 1. Database (10 min)

1. Create a project at [neon.tech](https://neon.tech) (or Supabase).
2. Copy the **pooled** connection string — Neon calls it the `-pooler` host,
   Supabase uses port `6543`. This matters: serverless creates many short-lived
   instances, and a direct connection limit is exhausted under mild load.
3. Keep it for step 5.

Then apply the schema from your own machine:

```bash
DATABASE_URL="<your pooled connection string>" npx prisma migrate deploy
```

`migrate deploy` applies the committed migrations and never invents new ones —
it is the only migration command that should ever run against production.

## 2. Email (10 min)

1. Sign up at [resend.com](https://resend.com).
2. Add your domain and complete the DNS records they give you. **Do not skip
   this** — sending from an unverified domain lands password resets in spam,
   and a password reset that does not arrive is an account you have lost.
3. Create an API key.

## 3. Stripe (20 min)

1. In the Stripe dashboard, create a **Product** — "Niche Expense Scanner" —
   with a **recurring monthly Price**. Copy the price id (`price_...`).
2. Copy your **secret key** (`sk_live_...`). Use test keys (`sk_test_...`)
   until you have run a real checkout through.
3. Enable **Stripe Tax** under Settings → Tax. SaaS is taxable in many US
   states and across the EU; switching this on now is far cheaper than
   reconstructing what was owed later.
4. Activate the **Customer Portal** under Settings → Billing → Customer portal,
   and allow cancellation. The app links to it; without it, subscribers have to
   email you to cancel, which is a consumer-protection problem in several
   jurisdictions.
5. Leave the webhook until step 6 — it needs your live URL.

## 4. Deploy (15 min)

1. Push this repository to GitHub (already done) and import it at
   [vercel.com/new](https://vercel.com/new).
2. Framework preset: **Next.js**. No build command changes needed.
3. Add your domain under the project's Domains tab and follow the DNS steps.

## 5. Environment variables (10 min)

In Vercel → Settings → Environment Variables, add:

```
DATABASE_URL          <pooled connection string from step 1>
AUTH_SECRET           <run: openssl rand -base64 48>
APP_URL               https://yourdomain.com
EMAIL_DRIVER          resend
RESEND_API_KEY        <from step 2>
EMAIL_FROM            Niche Expense Scanner <hello@yourdomain.com>
STRIPE_SECRET_KEY     <from step 3>
STRIPE_PRICE_ID       <from step 3>
STRIPE_WEBHOOK_SECRET <filled in at step 6>
TRIAL_DAYS            14
PRICE_LABEL           $7/month
SUPPORT_EMAIL         <an address you actually read>
```

`AUTH_SECRET` must be genuinely random and must never change after launch —
rotating it signs out every user at once.

Leave `RECEIPT_STORAGE_DRIVER` unset. The local driver writes to disk, and
Vercel's filesystem is ephemeral, so images would vanish between requests. See
"Receipt images" below.

## 6. Stripe webhook (10 min)

1. Stripe → Developers → Webhooks → **Add endpoint**.
2. URL: `https://yourdomain.com/api/webhooks/stripe`
3. Events: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`
4. Copy the **signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` and
   redeploy.

The webhook is the only thing that grants paid access. If it is missing or
misconfigured, customers will be charged and stay locked out — so verify it:
Stripe's dashboard shows delivery attempts and responses for every event.

## 7. Before you take the first real payment (15 min)

Run through this yourself, on the live site, with Stripe in **test mode** and
card `4242 4242 4242 4242`:

- [ ] Sign up. The confirmation email **arrives** (check spam).
- [ ] Log an expense by scanning a real receipt.
- [ ] Sign out, use "Forgot your password?", and get back in from the email.
- [ ] Subscribe through checkout. Settings shows "Subscribed" **within a few
      seconds** — if it does not, the webhook is wrong; fix it before going live.
- [ ] Open the billing portal and confirm you can cancel.
- [ ] Export the CSV and open it in a spreadsheet.
- [ ] Read `/legal/terms` and `/legal/privacy` and make them true — see below.
- [ ] Switch Stripe to live keys and redeploy.

## 8. Backups (5 min)

Turn on automated backups with your database provider, and **restore one into a
scratch database once** to prove it works. You are holding people's tax
substantiation; an untested backup is not a backup.

---

## The legal documents

`/legal/terms` and `/legal/privacy` are drafted and honest about what this code
actually does, but **they have not been reviewed by a lawyer.** Before charging:

- Set `SUPPORT_EMAIL` to a real, monitored address.
- Add your legal or trading name and country.
- If you will have EU or UK customers, have both documents reviewed. GDPR
  brings obligations — a data processing agreement with your suppliers, a
  lawful basis for each purpose, breach notification timelines — that generic
  templates handle badly.

The privacy policy already discloses the one thing most templates would miss:
if an artist enables receipt image retention, the stored photograph may contain
a *third party's* details, such as a client's name on a deposit slip.

## Receipt images in production

The bundled `local` driver needs a persistent disk and will not work on Vercel.
To offer image retention, implement the three-method `StorageDriver` contract in
`src/lib/storage/driver.ts` against S3 or Cloudflare R2 and return it from
`resolveStorage()`. No call site changes. Until then leave the driver unset:
the app works fully, the feature is simply absent, and the UI says so honestly.

## What is deliberately still missing

Being straight about the edges, so nothing surprises you later:

- **No error tracking.** Unhandled errors log an incident id to the server
  console and nowhere else. Add Sentry early — it is a ten-minute job and it is
  how you find out about breakage before a customer emails.
- **Rate limiting is per-instance.** In memory, so with several Vercel
  instances the effective limits are multiplied. Fine at launch; move
  `enforceRateLimit` onto Redis before you have real traffic.
- **`'unsafe-inline'` in the script CSP**, required by Next's runtime. Moving to
  per-request nonces is the hardening step.
- **No admin view.** You will be reading the database directly for support.
