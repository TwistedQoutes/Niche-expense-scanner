#!/usr/bin/env node
/**
 * Checks that the database still enforces the tenant boundary.
 *
 * Every relation between two tenant-owned tables references
 * `(organizationId, id)` rather than `id`, so a row pointing at another
 * business's record is one Postgres refuses to store (see
 * prisma/migrations/20260913000000_tenant_composite_foreign_keys). This script
 * verifies two properties of that arrangement which are easy to lose silently.
 *
 * 1. Every such constraint is still composite. A single-column foreign key here
 *    means the boundary is back to being a promise made by application code.
 *
 * 2. Every composite constraint with ON DELETE SET NULL still carries a column
 *    list. Prisma cannot express `SET NULL ("customerId")` and emits the plain
 *    form, which nulls the whole key — including `organizationId`, which is NOT
 *    NULL. The constraint still *looks* right and the schema still validates;
 *    what breaks is deleting a customer, in production, with a not-null
 *    violation. `prisma migrate diff` reports no drift either way, so nothing
 *    else in the toolchain will notice. This is the check that does.
 *
 * Postgres records the column list in `pg_constraint.confdelsetcols`, so the
 * question can be asked directly rather than inferred from DDL text.
 *
 * Run against a database that has had the migrations applied:
 *   DATABASE_URL=... node scripts/check-tenant-constraints.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The relations that must be composite, as (child table, referencing column).
 * Listed rather than derived: the point is to notice when the database stops
 * matching what this project decided, and a list derived from the database
 * itself could not tell the difference.
 */
const REQUIRED_COMPOSITE = [
  ['properties', 'customerId'],
  ['leads', 'customerId'],
  ['leads', 'propertyId'],
  ['lead_activities', 'leadId'],
  ['pricing_rules', 'serviceId'],
  ['quotes', 'customerId'],
  ['quotes', 'leadId'],
  ['quotes', 'propertyId'],
  ['quote_items', 'quoteId'],
  ['quote_items', 'serviceId'],
  ['jobs', 'customerId'],
  ['jobs', 'propertyId'],
  ['jobs', 'quoteId'],
  ['jobs', 'serviceId'],
  ['appointments', 'customerId'],
  ['appointments', 'jobId'],
  ['appointments', 'serviceId'],
  ['conversations', 'customerId'],
  ['conversations', 'leadId'],
  ['messages', 'conversationId'],
  ['automation_runs', 'automationId'],
  ['review_requests', 'customerId'],
  ['review_requests', 'jobId'],
  ['files', 'leadId'],
  ['files', 'jobId'],
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Every foreign key on a tenant table, with the columns it spans, the action it
 * takes on delete, and the columns that action applies to.
 *
 * `confdelsetcols` is null for anything but a column-limited SET NULL, which is
 * exactly the distinction being checked.
 */
const rows = await prisma.$queryRaw`
  SELECT
    child.relname::text                                   AS child_table,
    con.conname::text                                     AS constraint_name,
    parent.relname::text                                  AS parent_table,
    con.confdeltype::text                                 AS on_delete,
    ARRAY(
      SELECT a.attname::text FROM unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    )                                                     AS columns,
    ARRAY(
      SELECT a.attname::text FROM unnest(coalesce(con.confdelsetcols, '{}')) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    )                                                     AS set_null_columns
  FROM pg_constraint con
  JOIN pg_class child ON child.oid = con.conrelid
  JOIN pg_class parent ON parent.oid = con.confrelid
  JOIN pg_namespace ns ON ns.oid = child.relnamespace
  WHERE con.contype = 'f' AND ns.nspname = 'public'
`;

const problems = [];

for (const [table, column] of REQUIRED_COMPOSITE) {
  const matching = rows.filter(
    (row) => row.child_table === table && row.columns.includes(column),
  );

  if (matching.length === 0) {
    problems.push(`${table}.${column}: no foreign key found at all.`);
    continue;
  }

  for (const row of matching) {
    if (!row.columns.includes('organizationId')) {
      problems.push(
        `${table}.${column} (${row.constraint_name}): references ${row.parent_table} by ` +
          `[${row.columns.join(', ')}] — not composite, so the tenant boundary is ` +
          `no longer enforced by the database.`,
      );
      continue;
    }

    // 'n' is SET NULL in pg_constraint.confdeltype.
    if (row.on_delete === 'n' && row.set_null_columns.length === 0) {
      problems.push(
        `${table}.${column} (${row.constraint_name}): ON DELETE SET NULL with no column ` +
          `list, so deleting a ${row.parent_table} will try to null organizationId and ` +
          `fail. Restore the column list: ON DELETE SET NULL ("${column}").`,
      );
    }
  }
}

/**
 * Asks the database to do the thing it is supposed to refuse.
 *
 * Shape is not behaviour. Everything above reads catalogue metadata, which would
 * still look correct if some future Postgres changed what a composite key with a
 * partial column list actually does. So one cross-tenant row is attempted for
 * real, inside a transaction that is always rolled back, and its rejection is
 * the assertion.
 */
async function verifyEnforcement() {
  let rejected = false;

  try {
    await prisma.$transaction(async (tx) => {
      const mine = await tx.organization.create({
        data: { name: 'constraint-check-a', slug: `cc-a-${Date.now()}`, timezone: 'UTC' },
        select: { id: true },
      });
      const theirs = await tx.organization.create({
        data: { name: 'constraint-check-b', slug: `cc-b-${Date.now()}`, timezone: 'UTC' },
        select: { id: true },
      });
      const theirCustomer = await tx.customer.create({
        data: { organizationId: theirs.id, firstName: 'Someone', lastName: 'Else' },
        select: { id: true },
      });

      try {
        await tx.lead.create({
          data: {
            organizationId: mine.id,
            firstName: 'Probe',
            phone: '+15125550000',
            source: 'MANUAL',
            position: 1000,
            // The whole point: another organization's customer.
            customerId: theirCustomer.id,
          },
        });
      } catch {
        rejected = true;
      }

      // Nothing here should survive, whatever the outcome.
      throw new Error('rollback');
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'rollback') throw error;
  }

  return rejected;
}

const enforced = await verifyEnforcement();
if (!enforced) {
  problems.push(
    'The database ACCEPTED a lead in one organization referencing another ' +
      "organization's customer. The tenant boundary is not being enforced.",
  );
}

await prisma.$disconnect();

if (problems.length > 0) {
  console.error(`Tenant constraint check failed (${problems.length}):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nSee the note at the top of prisma/schema.prisma. A `prisma migrate dev` that ' +
      'regenerated one of these constraints is the usual cause.',
  );
  process.exit(1);
}

console.log(
  `Tenant constraints OK: ${REQUIRED_COMPOSITE.length} composite foreign keys, ` +
    `every SET NULL limited to its own column, and a cross-tenant write refused.`,
);
