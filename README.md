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
| Mobile-first dashboard, month filter, CSV export | `src/components/dashboard/`, `src/app/api/expenses/export/` |

---

## Project structure

```
niche-expense-scanner/
├── prisma/
│   └── schema.prisma              # User + Expense models (money as integer cents)
├── prisma.config.ts               # Prisma 7 config: schema path + datasource URL
├── scripts/
│   ├── setup-ocr-assets.mjs       # Stages the OCR engine into public/ocr (git-ignored)
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
│   │   │   └── scan/page.tsx
│   │   └── api/
│   │       ├── auth/{signup,login,logout,me}/route.ts
│   │       ├── expenses/route.ts             # GET list + summary, POST create
│   │       ├── expenses/[id]/route.ts        # PATCH, DELETE
│   │       ├── expenses/export/route.ts      # CSV
│   │       ├── receipts/parse/route.ts       # OCR text → structured expense
│   │       └── health/route.ts               # Readiness probe
│   ├── components/
│   │   ├── ui/                    # Button, Field, Card, Alert, chips, badges, spinner
│   │   ├── auth/AuthForm.tsx      # Shared sign-in / sign-up form
│   │   ├── layout/{TopBar,BottomNav}.tsx
│   │   ├── scan/
│   │   │   ├── ReceiptScanner.tsx # Upload → OCR → parse → review state machine
│   │   │   └── ExpenseForm.tsx    # Review-and-save, with per-field confidence
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
│   │   ├── money.ts               # Integer-cent arithmetic and parsing
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
│   │   ├── ocr/
│   │   │   ├── preprocess.ts      # Downscale, greyscale, contrast stretch
│   │   │   ├── client.ts          # Tesseract worker lifecycle + progress
│   │   │   └── parse-receipt.ts   # Text → merchant/total/tax/date + confidence
│   │   └── expenses/
│   │       ├── queries.ts         # Listing, month summary, tenant scoping
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

Requires Node 20+.

```bash
npm install                     # also stages the OCR engine and generates the Prisma client
cp .env.example .env            # then set AUTH_SECRET
npm run db:push                 # create the SQLite database
npm run db:seed                 # optional: demo account with sample expenses
npm run dev                     # http://localhost:3000
```

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
| `npm run db:push` / `db:migrate` / `db:studio` | Prisma schema and data tools |
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

### 4. Dashboard and CSV export

The first month renders on the server; month switching, re-categorising and deleting happen
client-side. Month totals are aggregated **in the database**, not over the fetched page, so
the summary describes the whole month even when the table is paginated.

Layout is mobile-first in a specific way: below `sm` each expense is a stacked row, and from
`sm` up the same data becomes a real table with column headers. A `<table>` at 360px means
horizontal scrolling, which is where expense trackers become unusable on a phone.

Export sends `?month=YYYY-MM` for one month or nothing for all time, and includes a totals
row plus the Schedule C mapping. Two details that matter:

- **Formula-injection defence.** A cell starting with `=`, `+`, `-` or `@` is executed as a
  formula by Excel, Sheets and Numbers. Merchant names and notes come from OCR of an
  untrusted image, so every such cell is prefixed with an apostrophe.
- **A UTF-8 BOM**, without which Excel on Windows renders `£` and `—` as mojibake — a small
  thing that decides whether the export looks broken to an accountant.

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
| Receipt privacy | Images are processed in the browser and never uploaded; only recognised text is posted |
| Secrets | Validated at boot (`AUTH_SECRET` ≥ 32 chars); `.env` is git-ignored and errors log key names, never values |
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

71 tests over the logic where a bug is expensive and silent:

- **`parse-receipt`** — subtotal vs total, cash tendered, "total items", ambiguous and
  textual dates, future-date rejection, non-USD currency, incoherent tax, merchant selection,
  and a fixture of **verbatim noisy Tesseract output** including its real mistakes.
- **`classify`** — one case per category, word-boundary safety, supplier-prior precedence,
  confidence ordering, and the guarantee that an alternative is never reported as more likely
  than the winner.
- **`money`** — integer-cent arithmetic, US and European separators, float-drift cases, and
  the ambiguous inputs that are deliberately rejected.
- **`dates`** — UTC calendar-day handling, half-open month ranges, year rollover, rejection
  of dates like `2026-02-31` that `new Date` would silently roll over.
- **`csv`** — quoting and formula-injection neutralisation.

The full scan flow was also driven end-to-end in a real Chromium — sign-up, image upload,
in-browser OCR, review, save, dashboard, CSV download — against a rendered receipt image.

---

## Going to production

1. **Postgres.** Set `provider = "postgresql"` in `prisma/schema.prisma`, swap
   `PrismaBetterSqlite3` for `PrismaPg` in `src/lib/db.ts`, then `npm run db:migrate`.
   Add `mode: 'insensitive'` to the search filter in `expenses/queries.ts`.
2. **Shared rate limiting.** The limiter is per-process. Behind more than one instance,
   back `enforceRateLimit` with Redis — the call sites do not change.
3. **Tighten the CSP.** `script-src` currently allows `'unsafe-inline'` for Next's runtime;
   move to a per-request nonce.
4. **Session revocation.** JWTs are self-contained, so sign-out is client-side only. For
   "sign out everywhere", add a `sessionVersion` column and check it in `requireUser()`.
5. **Password reset and email verification.** Neither exists yet; both need an email provider.
6. **Receipt image storage.** `RECEIPT_STORAGE_DRIVER` is scaffolded but images are currently
   never persisted. If an audit trail requires them, add object storage with per-user prefixes
   and signed URLs — and revisit the privacy claim in the UI copy.
7. **Observability.** Incident ids are logged but not shipped anywhere; wire up error tracking
   and alert on the `/api/health` probe.

---

## Known limitations

- **English only.** One Tesseract language model is bundled; other languages need another
  model and category keywords to match.
- **One category per receipt.** A mixed supply order is filed under its dominant category
  and flagged for review. Splitting a receipt across categories is the obvious next feature.
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
