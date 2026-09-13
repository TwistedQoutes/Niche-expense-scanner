# Performance pass — Phase 14

Measured, not guessed. Everything below is against one workspace seeded to the
size of a busy operator with a few years of history, because near-empty dev data
makes every query look fast and every plan look fine:

| | rows |
|---|---|
| customers | 4,000 |
| properties | 4,000 |
| leads | 12,000 |
| quotes | 8,000 (2,080 attached to a lead) |
| jobs | 6,000 (all attached to a quote) |
| appointments | 5,000 |
| conversations | 4,000 |
| messages | 40,000 |

Timings are warm, best-of-five, over HTTP against a production build on the same
host — so they include the query, the server render and the response, which is
what the person using it actually waits for.

## What was wrong: one query, 85% of a page

| Page | Before | After |
|---|---|---|
| `/analytics` | 294 ms | **146 ms** |
| `/leads` | 94 ms | 70 ms |
| `/dashboard` | 52 ms | 35 ms |
| `/jobs` | 38 ms | 37 ms |
| everything else | 12–39 ms | unchanged |

`/analytics` was the only page out of line, and inside it one of seven queries
was almost all of the cost:

| | Before | After |
|---|---|---|
| `loadFunnel` | 210 ms | **24 ms** |
| `loadSpeed` | 73 ms | 63 ms |
| `monthlySeries` | 55 ms | 52 ms |
| `loadServiceMix` | 12 ms | 11 ms |
| `loadSources` | 4 ms | 16 ms |
| `loadTopCustomers` | 2 ms | 2 ms |

Narrowing further, `loadFunnel` runs five counts in parallel and **one** of them
was 213 ms of its 210 ms wall time — the "won" stage, which asks for leads that
are either marked WON or have an accepted quote:

```
leads         wall     4.0ms   rows=12000
qualified     wall     4.2ms   rows=10000
quoted        wall     2.0ms   rows=1534
won           wall   213.8ms   rows=2398   ← here
completed     wall     2.4ms   rows=308
```

Prisma compiles that relation condition into a correlated `EXISTS`:

```sql
EXISTS (SELECT … FROM quotes t0
        WHERE t0.status = 'ACCEPTED'
          AND (leads."organizationId", leads.id) = (t0."organizationId", t0."leadId"))
```

There was no index on `quotes(organizationId, leadId)`, so every candidate lead
re-scanned the quotes table. **Postgres does not index a foreign key for you** —
it creates the constraint and nothing else.

This also traces back to the composite foreign keys added one migration earlier:
the correlation is now on a two-column key, so even a single-column index on
`leadId` would not have served it. The composite keys made the missing index
sharper, not different — it was already missing.

## The fix: index every foreign key

Rather than patch the one query, `20260913010000_index_foreign_keys` indexes all
17 foreign keys that had no supporting index. They are read two ways and both
need one:

* **Relations traversed on read** — the funnel above, and any `some`/`every`
  filter through a relation.
* **Every referential action** — deleting a customer has to find the rows
  pointing at them before it can cascade or clear the reference. On an unindexed
  key that is a sequential scan per delete, per referencing table.

Three of them (`audit_logs.actorUserId`, `jobs.assignedUserId`,
`notifications.userId`) point at `users` rather than a tenant table. Nothing in
the product deletes a user except the demo sweep, so those earn their place on the
delete path rather than on any read.

## What was deliberately left alone

Each of these was measured and found not worth the change. Recorded so the next
person does not re-derive it.

**No N+1 queries in any read path.** The only per-row queries in a loop are in the
automation worker and the reactivation sweep, and both are per-item by necessity:
the worker claims each run with a conditional `updateMany` that *is* the row lock,
and the sweep fires one trigger per customer. Batching either would break the
thing that makes it correct.

**No index for the pipeline board.** `loadBoard` sequentially scans and sorts —
there is no index for `ORDER BY position, "createdAt" DESC` — but it costs 14 ms
of the 70 ms `/leads` page. The other 56 ms is React rendering 500 cards. An extra
index on `leads`, the most written-to table in the product, to save a few
milliseconds of a page dominated by rendering is a bad trade.

**No index for the jobs list.** `ORDER BY "scheduledFor" ASC NULLS FIRST` cannot
use a plain ascending index (ascending defaults to NULLS LAST), and Prisma cannot
express `NULLS FIRST` in `@@index`. Writing it in raw SQL would put an index in
the database that Prisma's schema does not know about, which `migrate dev` would
offer to drop. The query is 2.7 ms at 6,000 jobs. Not worth that trap.

**No raw SQL for the remaining analytics cost.** `loadSpeed` (63 ms) and
`monthlySeries` (52 ms) fetch rows and aggregate them in JavaScript — 12,000
leads to produce a 12-point chart. Postgres could return 12 rows instead, with
`date_trunc` in a `$queryRaw`. The reason not to: **the tenant client does not
scope raw queries.** Every safe query in this codebase gets `organizationId`
injected by the extension in `src/lib/db/tenant.ts`, and a raw query opts out of
that, leaving the filter to whoever edits the string next. Trading the one
invariant the whole multi-tenant design rests on for 100 ms on a page nobody
loads in a loop is the wrong way round. If analytics ever needs it, the answer is
a materialised monthly rollup table — still tenant-scoped, still covered by the
extension — not raw SQL in a read path.

**No trigram index for search.** Customer and lead search use `contains`, which
is `ILIKE '%…%'` and cannot use a B-tree. At 12,000 leads it takes 13.7 ms. When
that stops being true the answer is `pg_trgm` with a GIN index.

## Reproducing this

The volume seed is not committed — it exists to be thrown away, and a script that
inserts 40,000 rows is not something to leave where it could be run against
anything real. The shape is in this document: one organization, the row counts in
the first table, `generate_series` for each table, then `ANALYZE`.
