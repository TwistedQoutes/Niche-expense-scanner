#!/usr/bin/env node
/**
 * Backfills one ExpenseLine per legacy expense.
 *
 * Categorisation moved from Expense onto ExpenseLine so a single receipt can be
 * split across categories. Rows written before that change carry their category
 * in the now-deprecated `Expense.category` columns and have no lines, so this
 * copies each one into a single line covering the whole receipt total.
 *
 * Safe to re-run: expenses that already have lines are skipped, so this can be
 * left in a deploy script. Run it after `prisma db push` has created the table.
 *
 *   npm run db:backfill
 *
 * Once every deployment has run this, the deprecated columns can be dropped
 * from prisma/schema.prisma.
 */
import process from 'node:process';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

const BATCH_SIZE = 500;

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  let created = 0;
  // Counted up front: the query below excludes already-migrated rows, so they
  // would otherwise be invisible in the summary.
  const alreadyMigrated = await prisma.expense.count({ where: { lines: { some: {} } } });

  for (;;) {
    // `lines: { none: {} }` is the whole selector: anything already carrying a
    // line is either new or already migrated.
    const batch = await prisma.expense.findMany({
      where: { lines: { none: {} } },
      select: {
        id: true,
        amountCents: true,
        category: true,
        categoryConfidence: true,
        categorySource: true,
      },
      take: BATCH_SIZE,
    });

    if (batch.length === 0) break;

    await prisma.expenseLine.createMany({
      data: batch.map((expense) => ({
        expenseId: expense.id,
        label: null,
        amountCents: expense.amountCents,
        // A row with no legacy category at all is possible if it was written by
        // hand; "OTHER" keeps it visible and editable rather than dropping it.
        category: expense.category ?? 'OTHER',
        categoryConfidence: expense.categoryConfidence ?? 0,
        categorySource: expense.categorySource === 'manual' ? 'manual' : 'auto',
        position: 0,
      })),
    });

    created += batch.length;
    if (batch.length < BATCH_SIZE) break;
  }

  // Report the invariant, not just the row count: a mismatch here would mean
  // the money on the lines disagrees with the receipts they belong to.
  const expenses = await prisma.expense.findMany({
    select: { id: true, amountCents: true, lines: { select: { amountCents: true } } },
  });

  const unbalanced = expenses.filter(
    (expense) =>
      expense.lines.reduce((sum, line) => sum + line.amountCents, 0) !== expense.amountCents,
  );

  console.log(`[backfill] created ${created} line(s), skipped ${alreadyMigrated} already-migrated`);
  console.log(`[backfill] ${expenses.length} expense(s) checked, ${unbalanced.length} unbalanced`);

  if (unbalanced.length > 0) {
    console.error('[backfill] these expenses do not match the sum of their parts:');
    for (const expense of unbalanced.slice(0, 20)) console.error(`  - ${expense.id}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[backfill] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
