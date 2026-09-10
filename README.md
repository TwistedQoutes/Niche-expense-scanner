# Niche Expense Scanner

Receipt scanning and expense tracking built for **freelance tattoo artists and studios**.

Photograph a supplier receipt; it is read on-device, the total/date/merchant are pulled out,
the expense is filed under a tattoo-specific category, and the month exports as a
spreadsheet that maps every category to its Schedule C line.

The wedge is the taxonomy. A general expense tracker offers "Supplies" and leaves an artist
to sort out needles, ink, stencil paper, barrier film, booth rent and a $1,200 client chair
by hand. This app knows the difference — including the brand names that appear on real
supplier invoices (Dynamic Black, Saniderm, Spirit Master, Cheyenne, TatSoul), which is what
makes automatic categorisation possible at all.

---

## Contents

- [Feature overview](#feature-overview)
- [Project structure](#project-structure)
- [Stack, and why](#stack-and-why)
- [Running it](#running-it)
- [How each feature works](#how-each-feature-works)
- [Security posture](#security-posture)
- [Error handling](#error-handling)
- [Tests](#tests)
- [Going to production](#going-to-production)
- [Known limitations](#known-limitations)

---

## Feature overview

| Feature | Where it lives |
| --- | --- |
| Email/password auth, JWT session in an http-only cookie | `src/lib/auth/`, `src/app/api/auth/` |
| Receipt upload + on-device OCR + field extraction | `src/lib/ocr/`, `src/components/scan/` |
| Tattoo-specific auto-categorisation | `src/lib/categories/` |
| Splitting one receipt across categories, suggested automatically | `src/lib/expenses/split.ts`, `src/components/scan/SplitEditor.tsx` |
| Mobile-first dashboard, month filter, CSV export | `src/components/dashboard/`, `src/app/api/expenses/export/` |
| Optional receipt image retention, off by default | `src/lib/storage/`, `src/app/api/expenses/[id]/receipt/` |
| Password reset, email verification, session revocation | `src/lib/auth/tokens.ts`, `src/app/api/auth/` |
| Stripe subscriptions with a trial and a read-only paywall | `src/lib/billing/`, `src/app/api/billing/`, `src/app/api/webhooks/stripe/` |
| Data export, account deletion, terms and privacy policy | `src/app/api/account/`, `src/app/legal/` |

---

## Project structure

```
niche-expense-scanner/
├── prisma/
│   └── schema.prisma              # User + Expense models (money as integer cents)
├── prisma.config.ts               # Prisma 7 config: schema path + datasource URL
├── scripts/
│   ├── setup-ocr-assets.mjs       # Stages the OCR engine into public/ocr (git-ignored)
│   ├── backfill-expense-lines.mjs # Idempotent migration for pre-split rows
│   └── seed.mjs                   # Demo account with a few months of expenses
├── public/
│   ├── icon.svg                   # App icon
│   ├── manifest.webmanifest       # Installable-to-homescreen metadata
│   └── ocr/                       # Generated: worker, WASM core, English model
├── src/
│   ├── proxy.ts                   # Optimistic cookie-presence route guard (was middleware.ts)
│   ├── app/
│   │   ├── layout.tsx             # Root layout, metadata, viewport, theme colour
│   │   ├── globals.css            # Tailwind v4 theme: palette, base layer, utilities
│   │   ├── page.tsx               # Landing page (redirects when signed in)
│   │   ├── icon.svg               # Favicon source
│   │   ├── error.tsx              # Route error boundary
│   │   ├── not-found.tsx          # 404
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   ├── (app)/                 # Authenticated shell — the real auth gate
│   │   │   ├── layout.tsx         # Verifies the session, renders nav
│   │   │   ├── dashboard/
│   │   │   │   ├── page.tsx       # Server-rendered first month
│   │   │   │   └── loading.tsx    # Skeleton
│   │   │   ├── scan/page.tsx
│   │   │   └── settings/page.tsx  # Receipt-retention opt-in
│   │   └── api/
│   │       ├── auth/{signup,login,logout,me}/route.ts
│   │       ├── expenses/route.ts             # GET list + summary, POST create
│   │       ├── expenses/[id]/route.ts        # PATCH, DELETE
│   │       ├── expenses/[id]/receipt/route.ts # Image upload / fetch / delete
│   │       ├── settings/route.ts             # Retention opt-in
│   │       ├── expenses/export/route.ts      # CSV
│   │       ├── receipts/parse/route.ts       # OCR text → structured expense
│   │       └── health/route.ts               # Readiness probe
│   ├── components/
│   │   ├── ui/                    # Button, Field, Card, Alert, chips, badges, spinner
│   │   ├── auth/AuthForm.tsx      # Shared sign-in / sign-up form
│   │   ├── layout/{TopBar,BottomNav}.tsx
│   │   ├── scan/
│   │   │   ├── ReceiptScanner.tsx # Upload → OCR → parse → review state machine
│   │   │   ├── ExpenseForm.tsx    # Review-and-save, with per-field confidence
│   │   │   └── SplitEditor.tsx    # Split across categories, with a live balance
│   │   └── dashboard/
│   │       ├── DashboardClient.tsx    # Month state, optimistic updates
│   │       ├── SummaryCards.tsx
│   │       ├── MonthFilter.tsx
│   │       ├── ExpenseTable.tsx       # Stacked rows on mobile, table on desktop
│   │       ├── CategoryBreakdown.tsx
│   │       └── ExportButton.tsx
│   ├── lib/
│   │   ├── env.ts                 # Zod-validated environment, fails fast at boot
│   │   ├── db.ts                  # Prisma client singleton + driver adapter
│   │   ├── cn.ts                  # Tailwind-aware class merge
│   │   ├── api-client.ts          # Typed fetch wrapper → ApiError
│   │   ├── validation.ts          # Every request schema, shared with the forms
│   │   ├── money.ts               # Integer-cent arithmetic, parsing, apportionment
│   │   ├── dates.ts               # UTC calendar-day handling, month keys
│   │   ├── csv.ts                 # Quoting + formula-injection defence
│   │   ├── api/
│   │   │   ├── errors.ts          # AppError → HTTP status mapping
│   │   │   ├── response.ts        # JSON helpers, Zod → field errors
│   │   │   ├── handler.ts         # withRoute wrapper, safe body reading
│   │   │   └── rate-limit.ts      # Fixed-window limiter
│   │   ├── auth/
│   │   │   ├── password.ts        # bcrypt + timing equalisation
│   │   │   ├── session.ts         # JWT sign/verify, cookie flags
│   │   │   └── current-user.ts    # requireUser() / getCurrentUser()
│   │   ├── categories/
│   │   │   ├── taxonomy.ts        # 16 categories, keywords, brands, Schedule C lines
│   │   │   └── classify.ts        # Transparent scoring classifier
│   │   ├── storage/
│   │   │   ├── driver.ts          # Driver contract, key generation + validation
│   │   │   ├── local.ts           # Local-disk driver, path-containment checked
│   │   │   ├── sniff.ts           # Magic-byte image identification
│   │   │   └── index.ts           # Driver resolution from config
│   │   ├── ocr/
│   │   │   ├── preprocess.ts      # Downscale, greyscale, contrast stretch
│   │   │   ├── client.ts          # Tesseract worker lifecycle + progress
│   │   │   └── parse-receipt.ts   # Text → merchant/total/tax/date + confidence
│   │   └── expenses/
│   │       ├── queries.ts         # Listing, month summary, tenant scoping
│   │       ├── split.ts           # Groups line items into a proposed split
│   │       └── serialise.ts       # Row → DTO
│   └── types/index.ts             # Wire types shared by client and server
└── tests/                         # Vitest: parser, classifier, money, dates, CSV
```

---

## Stack, and why

| Choice | Reasoning |
| --- | --- |
| **Next.js 16 (App Router)** | One deployable for UI and API. Server components render the first month of data with no client round-trip, which is what makes the dashboard feel instant on a phone. |
| **TypeScript, `strict` + `noUncheckedIndexedAccess`** | Money and dates are the two things that must not be wrong. |
| **Tailwind CSS v4** | Design tokens live in `globals.css` as a `@theme` block; mobile-first utilities keep the responsive rules next to the markup they affect. |
| **Prisma 7 + SQLite** | Zero-setup prototype. Prisma 7 connects through a driver adapter, so moving to Postgres is a provider swap plus one adapter change — no query rewrites. |
| **`jose` + bcrypt (own auth)** | ~120 lines, no third-party auth service, no vendor lock-in, and every security decision is visible in the repo. |
| **`tesseract.js`, self-hosted** | OCR runs in the browser: receipt images never reach the server, there is no per-scan cost, and no API key to leak. The engine is served from `/ocr`, so the CSP stays `'self'`-only and there is no CDN dependency. |
| **`zod`** | One schema per endpoint, reused by the forms, so a validation message is written once. |
| **Vitest** | The parser and classifier are pure functions — the highest-value things to test and the cheapest to test well. |

---

## Running it

Requires Node 22.12+ and a Postgres database.

```bash
npm install                     # also stages the OCR engine and generates the Prisma client
cp .env.example .env            # set DATABASE_URL and AUTH_SECRET
npx prisma migrate deploy       # create the schema
npm run db:seed                 # optional: demo account with sample expenses
npm run dev                     # http://localhost:3000
```

**Deploying for real?** `DEPLOYMENT.md` is the click-by-click runbook: database,
email, Stripe, environment variables, the webhook, and the checklist to run
before taking a first payment.

Postgres in every environment, including local development — dev/prod parity
matters more than zero-setup once real money and real tax records are involved.

Generate a real secret:

```bash
openssl rand -base64 48
```

Seeded demo login: `demo@studio.test` / `tattoo-demo-2026`.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server (stages OCR assets first) |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run db:migrate` / `db:studio` | Create a migration, browse data |
| `npm run db:migrate:deploy` | Apply committed migrations — the production command |
| `npm run db:backfill` | One-off: gives pre-split rows their category line |
| `npm run setup:ocr` | Re-stage `public/ocr` |

---

## How each feature works

### 1. Authentication

Sign-up hashes the password with bcrypt at cost 12 and issues an HS256 JWT, stored in a
cookie that is `httpOnly` (so XSS cannot read it), `sameSite=lax` (so cross-site POSTs are
blocked), and `secure` in production.

Authorisation happens in two layers, deliberately:

- `src/proxy.ts` (the file convention Next 16 renamed from `middleware.ts`) checks only
  that a session cookie **exists**, and redirects if not. It runs on every request — and may
  be deployed to a CDN edge — so it stays cheap and holds no crypto.
- `requireUser()` (`src/lib/auth/current-user.ts`) verifies the signature, issuer, audience
  and expiry, then re-reads the user row — so a deleted account cannot keep acting on a
  token that has not expired yet. Every protected page and route handler calls it.

Login returns one message and one timing profile for both "no such email" and "wrong
password" (`burnPasswordTiming`), so the endpoint cannot be used to enumerate accounts.
Duplicate sign-ups are caught by the unique constraint rather than a pre-check, closing the
race between two simultaneous registrations.

### 2. Receipt upload and OCR

The pipeline is: **preprocess → recognise → parse → review.**

`src/lib/ocr/preprocess.ts` runs three canvas operations on the chosen image. A phone photo
is the worst case for Tesseract — 12 megapixels, uneven studio lighting, a shadow down one
side — and downscaling to 1600px, converting to greyscale and stretching the contrast
histogram cuts recognition time by more than half while improving accuracy on thermal paper.

`src/lib/ocr/client.ts` owns one reused Tesseract worker and reports progress, because a
~15 MB first-run engine download with no feedback looks like a broken app.

`src/lib/ocr/parse-receipt.ts` turns the recognised text into fields. Receipts have no
schema, so this is a **scoring** parser rather than a matcher: it collects every plausible
candidate for each field, ranks them, and reports per-field confidence.

- **Total**: label-weighted (`grand total` > `total due` > `total`), with an explicit
  exclusion list for `subtotal`, `total items`, `cash tendered` and `change due` — the four
  most common ways a receipt parser reports the wrong number. Position matters too, since
  totals print at the bottom.
- **Date**: ISO wins outright; textual months next; numeric formats resolve day/month order
  using the one signal available (a component above 12 must be the day) and otherwise assume
  US order at lower confidence. If nothing parses, a **single-digit repair pass** runs — a
  real test scan turned `09/03/2026` into `89/03/2026`, and without this the date is dropped,
  the form quietly defaults to today, and the expense lands in the wrong month. A repair is
  only accepted when exactly one substitution yields a plausible date.
- **Merchant**: chosen from the header block by position, letter density, capitalisation and
  the absence of address/phone/label markers.

Everything then lands in an **editable** review form (`ExpenseForm.tsx`) with a confidence
badge on any shaky field, and an explicit "couldn't read this" marker on any field that came
back empty. Being visibly unsure about one field is far more useful than being silently
wrong about it.

There is always a manual-entry path: OCR fails on faded thermal paper no matter how good the
preprocessing, and a tracker that can only be fed by camera is useless the moment that
happens.

### 3. Niche categorisation

`src/lib/categories/taxonomy.ts` defines 16 categories, each with weighted keywords, real
supplier brand names, chip colours and its IRS Schedule C line:

Needles & Cartridges · Ink & Pigments · Stencil & Transfer · Gloves & PPE ·
Sterilisation & Cleaning · Aftercare & Bandaging · Machines & Power · Furniture & Fixtures ·
Booth & Studio Rent · Licences & Insurance · Art & Design Supplies · Marketing & Branding ·
Software & Payment Fees · Travel & Conventions · Utilities & Phone · Uncategorised

`classify.ts` scores every category against the normalised receipt text. Design notes:

- **Word-boundary matching.** Without it "ink" matches "drinking" and "mask" matches
  "damaged" — exactly the silent mis-categorisation that makes an artist stop trusting the app.
- **Supplier names are a weak prior only.** A tattoo supply house sells needles, ink,
  furniture and soap alike, so the merchant can never outvote a line item; it only breaks
  ties or rescues a receipt whose items failed to OCR.
- **Confidence has two factors**: how much keyword evidence exists, and how clearly the
  winner beat the runner-up. A mixed supply order scores lower and gets flagged for review,
  which is the honest answer for a receipt that genuinely spans three categories.
- **It explains itself.** The matched terms are returned and shown ("Matched *needles*,
  *cartridge*, *3rl*"), and the runner-up categories are offered as one-tap alternatives.
- **A rule engine, not a model.** Auditable, unit-testable, free per scan, and no receipt
  data leaves the server.

Picking a category by hand sets `categorySource: 'manual'`, so the app stops second-guessing
it and the dashboard can distinguish a guess (✨) from a decision.

### 3b. Splitting one receipt across categories

A single supplier order routinely contains needles, ink and gloves — three different Schedule
C entries on one piece of paper. Forcing it into one category either loses that detail or files
the whole amount under the wrong line, so a receipt is stored as an **`Expense` plus one or
more `ExpenseLine` rows**, one per category. An unsplit receipt has exactly one line, so the
rest of the app has a single shape to read rather than two that can disagree.

**The invariant that makes it trustworthy:** the lines always sum to `Expense.amountCents`, to
the cent. It is enforced in `src/lib/validation.ts` on create and update, checked in the form
before the round trip, verified by the backfill script, and re-checked in tests. Without it the
month total and the category breakdown drift apart and the CSV stops reconciling — the kind of
wrongness nobody notices until an accountant does.

**The split is suggested, not demanded.** `suggestSplit` reads the receipt's own itemisation
(`extractLineItems`), classifies each product line independently, and groups by category — so a
four-needle, one-ink order is a two-way split, not a five-way one. Two details matter:

- The **full total** is apportioned across the groups pro-rata to their item amounts, using the
  largest-remainder method (`apportionCents`). Tax and shipping therefore spread across
  categories in proportion to what caused them, and the parts sum to the total exactly —
  naive division would give three shares of $10.00 as 333+333+333 and lose a penny.
- It **declines to guess**. No suggestion is offered unless there are two or more distinct
  categories, at least one confidently identified, and a known total. A wrong split is more
  annoying to unpick than no split.

The artist accepts it in one tap, edits it, or ignores it. The editor shows what is left to
account for live, and offers to drop the remainder onto a line in one tap, so an unbalanced
split is fixed before saving rather than rejected after.

### 4. Dashboard and CSV export

The first month renders on the server; month switching, re-categorising and deleting happen
client-side. Month totals are aggregated **in the database**, not over the fetched page, so
the summary describes the whole month even when the table is paginated.

Layout is mobile-first in a specific way: below `sm` each expense is a stacked row, and from
`sm` up the same data becomes a real table with column headers. A `<table>` at 360px means
horizontal scrolling, which is where expense trackers become unusable on a phone.

A split receipt shows its categories as chips on one row and stays **one** receipt in the
count — the "Receipts" and "Average" stats describe receipts, while the breakdown describes
categories. Both are aggregated in the database (totals from the expense rows, the breakdown
from the lines), and the sum invariant guarantees they agree.

Export sends `?month=YYYY-MM` for one month or nothing for all time, and emits **one row per
category share** so a split receipt lands on the two or three Schedule C lines it belongs to
rather than needing to be unpicked by hand. `Part of receipt` ("2 of 3") keeps the rows
traceable to one document, and the receipt total is stated once per receipt so a naive sum of
that column does not double-count. Three details that matter:

- **Formula-injection defence.** A cell starting with `=`, `+`, `-` or `@` is executed as a
  formula by Excel, Sheets and Numbers. Merchant names and notes come from OCR of an
  untrusted image, so every such cell is prefixed with an apostrophe.
- **A UTF-8 BOM**, without which Excel on Windows renders `£` and `—` as mojibake — a small
  thing that decides whether the export looks broken to an accountant.

### 5. Receipt image retention (optional)

Scanning reads the receipt on the artist's own device and only ever needed the *text*. Keeping
the *image* is a separate decision, because it changes what we hold about someone — so it is
**off by default and gated twice**:

1. The deployment must configure a driver (`RECEIPT_STORAGE_DRIVER=local`). With `none`, the
   default, the routes 404 and the feature does not exist.
2. The artist must opt in on their own account. Nothing is uploaded until they do.

Why offer it at all: the IRS expects documentary evidence for expenses over $75, and a photo of
the receipt is that evidence. Why it is off by default: a receipt can show a client's name or a
card's last four digits.

**The stored image is not the raw photo.** It is re-encoded in the browser first, which strips
EXIF — and on most phones EXIF includes GPS coordinates, so an unmodified receipt photo records
where the artist was standing. The re-encode also downscales it, because a 12-megapixel original
is several megabytes to prove a $24.50 ink purchase. The OCR-preprocessed copy is deliberately
*not* what gets stored: greyscale and contrast-stretched is tuned for a text recogniser and
makes a poor audit record.

Security decisions worth naming:

- **The declared content type is ignored.** Uploads are identified by magic bytes
  (`sniffImageType`), because these bytes are served back to a browser later and a mislabelled
  HTML or SVG payload would be stored XSS. **SVG is rejected outright** — it is a document
  format that can carry script, not a picture.
- **Keys are generated server-side**, never accepted from a client, and carry a random
  component so knowing an expense id does not let you guess someone else's key.
- **Files live outside `public/`.** Every read goes through a route that verifies the requester
  owns the expense; a static path would make receipts readable by anyone who guessed a URL.
- **Two independent traversal defences**: a restrictive key pattern *and* a resolved-path
  containment check before any filesystem call.
- **Turning retention off deletes.** It is a deletion request, not just a preference change —
  the images already held are removed, and deleting an expense removes its image too, because
  the database cascade knows nothing about files on disk.

Uploading is deliberately decoupled from saving: if it fails, the artist still has their
expense and gets told the picture did not stick.

### 6. Accounts, billing and the paywall

**Password recovery** works on hashed, single-use tokens: only a SHA-256 of the
emailed token is stored, so a database leak is not an account-takeover kit.
Requesting a reset always answers identically whether or not the address exists,
so the endpoint cannot enumerate customers.

Completing a reset bumps `sessionVersion`, which is carried inside the session
JWT and compared on every request. That is what makes a self-contained token
revocable: resetting a password — or pressing "sign out on all devices" — kills
every existing session immediately, rather than leaving a stolen one valid for
up to a week.

**Billing** is Stripe Checkout (card details never touch this server, keeping
PCI scope minimal) plus a signature-verified, idempotent webhook. Every event id
is recorded before processing, so Stripe's retries cannot double-apply one; a
handler failure deletes that record so the retry can legitimately have another
go.

**The paywall's shape is the important part.** After the trial an account goes
*read-only*, not locked: an artist can still view, edit, export and delete
everything they have recorded — they simply cannot add new expenses. Holding
someone's tax substantiation hostage over a lapsed card is both indecent and a
reliable way to earn chargebacks in a community where everyone knows each other.
A `past_due` card keeps working while Stripe retries, for the same reason.

If Stripe is not configured at all, the app is free and fully functional. That
default is deliberate: a missing API key must never lock artists out of their
own records.

---

## Security posture

| Concern | Handling |
| --- | --- |
| Password storage | bcrypt, cost 12; 72-byte cap acknowledged in validation |
| Session | HS256 JWT, `httpOnly` + `sameSite=lax` + `secure`, issuer/audience checked, 7-day expiry |
| Account enumeration | Identical message and timing for both login failure modes |
| CSRF | `sameSite=lax` cookies; all mutations are POST/PATCH/DELETE with a JSON content-type requirement |
| Tenant isolation | `userId` applied inside `expenseWhere()` — one place decides scoping; updates and deletes filter by `userId`, so another artist's id changes nothing |
| Injection | Prisma parameterises everything; no raw SQL except a `SELECT 1` health probe |
| Input validation | Zod on every request body and query parameter; bodies size-capped before parsing |
| Rate limiting | Per-endpoint fixed windows: login 8/5min, signup 5/hr, OCR parse 60/5min, writes 120/5min |
| Headers | CSP (`'self'`-only, no CDN), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Receipt privacy | Text recognition runs in the browser, so the image never has to be uploaded. Retention is opt-in per artist and off by default; when on, EXIF (including GPS) is stripped before upload, and turning it off deletes what was kept. The UI copy changes with the setting rather than overclaiming |
| Uploaded file handling | Type established by magic bytes, not the declared header; SVG rejected; 5 MB cap enforced on both the declared and real length; served with `nosniff` and `private, no-store` |
| Storage path safety | Keys generated server-side with a random component, validated by pattern *and* resolved-path containment; files kept outside `public/` and reachable only through an ownership-checked route |
| Secrets | Validated at boot (`AUTH_SECRET` ≥ 32 chars, driver credentials checked against their driver); `.env` is git-ignored and errors log key names, never values |
| Password recovery | Single-use tokens, stored only as SHA-256, 1-hour expiry, redeemed by conditional update so a race cannot redeem twice; identical response whether or not the account exists |
| Session revocation | `sessionVersion` in the token is compared to the database each request — a password reset or "sign out everywhere" invalidates every outstanding session at once |
| Payment data | Stripe Checkout and Customer Portal; no card details reach this server. Webhooks are signature-verified against the raw body and made idempotent by event id |
| Account deletion | Requires the current password, removes stored images before the row, cancels the Stripe subscription, and cascades expenses and tokens |
| Error leakage | Unexpected errors return a generic message plus an incident id; details stay in the server log |

---

## Error handling

Route handlers are wrapped in `withRoute()`, which turns:

- `AppError` → its own status and a message safe to show a user,
- `ZodError` → 422 with per-field messages,
- anything else → a logged incident id and a generic 500.

On the client, `apiRequest()` raises a typed `ApiError` carrying `fieldErrors`, so a form
shows "An account with that email already exists" next to the email input without each
component re-deriving what a 409 means. Network failures, aborted requests, OCR start-up
failures, unreadable images and expired sessions all have their own user-facing copy.

---

## Tests

```bash
npm test
```

153 tests over the logic where a bug is expensive and silent:

- **`parse-receipt`** — subtotal vs total, cash tendered, "total items", ambiguous and
  textual dates, future-date rejection, non-USD currency, incoherent tax, merchant selection,
  and a fixture of **verbatim noisy Tesseract output** including its real mistakes.
- **`classify`** — one case per category, word-boundary safety, supplier-prior precedence,
  confidence ordering, and the guarantee that an alternative is never reported as more likely
  than the winner.
- **`money`** — integer-cent arithmetic, US and European separators, float-drift cases, the
  ambiguous inputs that are deliberately rejected, and an apportionment sweep asserting that a
  split balances across a range of awkward totals and weightings.
- **`split`** — line-item extraction against real OCR output, category grouping, pro-rata tax
  spreading, and every case where a split is deliberately *not* suggested.
- **`validation`** — the sum invariant from both directions, including a one-cent discrepancy,
  and a regression test for the partial-update currency bug described below.
- **`dates`** — UTC calendar-day handling, half-open month ranges, year rollover, rejection
  of dates like `2026-02-31` that `new Date` would silently roll over.
- **`csv`** — quoting and formula-injection neutralisation.
- **`storage`** — magic-byte sniffing (including SVG, HTML and a RIFF file that is not WebP),
  key validation, and a local driver that refuses to read or write outside its root.
- **`billing`** — every trial and subscription state, including the ones easy to get wrong:
  a `past_due` card that must keep working, a cancellation during a still-valid trial, and
  unknown Stripe statuses that must fail closed rather than assume the best.

The full scan flow was also driven end-to-end in a real Chromium — sign-up, image upload,
in-browser OCR, review, save, dashboard, CSV download — against a rendered receipt image,
including the split path: accepting a suggested three-way split, having an unbalanced edit
refused, repairing it in one tap, and confirming the exported CSV reconciles to the receipt.

Image retention was verified the same way, against a JPEG deliberately carrying a fake GPS
EXIF tag: opting in through the settings UI, scanning, and then inspecting the bytes actually
written to disk — the `Exif` marker and the planted coordinates are both gone, leaving only
JFIF and colour-profile segments. Access control was exercised directly: upload refused before
opt-in, another artist's fetch 404s, unauthenticated 401s, SVG and HTML uploads rejected as
unsupported, oversized and empty bodies rejected, and both deletion paths leaving zero files
behind.

### Continuous integration

`.github/workflows/ci.yml` runs typecheck, lint, tests and a production build on every push
to `main` and every pull request, across **Node 22 and 24** — the range `engines` claims, so
the claim is verified rather than trusted. Both versions gate; a failure on either is a real
failure. A production-dependency `npm audit` runs too, but advisory-only: an advisory
published upstream overnight should be visible without blocking an unrelated pull request.

Two environment variables are supplied as obvious placeholders, because the app validates its
environment at boot and both `prisma generate` and `next build` refuse to start without them.
Neither reaches a real database — the build only needs a well-formed URL, and no test opens a
connection.

To make the checks block merging rather than merely report, add them as required status checks
under Settings → Branches.

---

## Going to production

`DEPLOYMENT.md` has the full runbook. What remains genuinely undone:

1. **Object storage for receipt images.** The `local` driver needs a persistent
   disk, so image retention is unavailable on serverless hosting. Implement the
   three-method `StorageDriver` contract against S3/R2 and return it from
   `resolveStorage()` — no call site changes.
2. **Error tracking.** Incident ids are logged and go nowhere. Add Sentry.
3. **Shared rate limiting.** The limiter is per-process; behind several
   instances the effective limits multiply. Move `enforceRateLimit` to Redis.
4. **Tighten the CSP.** `script-src` still allows `'unsafe-inline'` for Next's
   runtime; per-request nonces are the hardening step.
5. **Drop the deprecated category columns** on `Expense`, once every deployment
   has run `npm run db:backfill`.
6. **Legal review.** The drafted terms and privacy policy are honest about what
   the code does but have not been seen by a lawyer — see DEPLOYMENT.md.

## Known limitations

- **English only.** One Tesseract language model is bundled; other languages need another
  model and category keywords to match.
- **A split needs the receipt to itemise.** The automatic suggestion reads the product lines
  off the receipt, so a till slip printing only a total cannot be split automatically — it can
  still be split by hand.
- **First scan downloads ~15 MB** of engine and model, cached by the browser afterwards.
- **HEIC** photos depend on browser support; the error message tells the artist to share as
  JPEG when decoding fails.
- **Schedule C mappings are general guidance, not tax advice**, and are stated as such in the
  UI and in the export.

---

## Dependency notes

`package.json` carries two `overrides`:

```json
"overrides": {
  "mysql2": "^3.24.4",
  "deepmerge-ts": "^8.0.0"
}
```

Both are transitive dependencies of the Prisma CLI (pulled in by `@prisma/client`) and are
never executed by this app, which talks to SQLite through a driver adapter. They are pinned
forward anyway so `npm audit` is clean at zero findings rather than four that need
explaining every time someone runs it.
