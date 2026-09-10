import type { Expense, ExpenseLine } from '@prisma/client';

import { isCategoryId } from '@/lib/categories/taxonomy';
import type { ExpenseDto, ExpenseLineDto } from '@/types';

/** An expense row with its lines loaded — what every read path selects. */
export type ExpenseWithLines = Expense & { lines: ExpenseLine[] };

/**
 * Single conversion point from database row to API payload.
 *
 * `category` and `categorySource` are stored as strings (portable across
 * SQLite and Postgres, and migration-free when the taxonomy grows), so they are
 * narrowed back to their union types here rather than being cast at each use.
 */
function serialiseLine(line: ExpenseLine): ExpenseLineDto {
  return {
    id: line.id,
    label: line.label,
    amountCents: line.amountCents,
    category: isCategoryId(line.category) ? line.category : 'OTHER',
    categoryConfidence: line.categoryConfidence,
    categorySource: line.categorySource === 'manual' ? 'manual' : 'auto',
    position: line.position,
  };
}

export function serialiseExpense(expense: ExpenseWithLines): ExpenseDto {
  const lines = [...expense.lines].sort((a, b) => a.position - b.position);

  return {
    id: expense.id,
    merchant: expense.merchant,
    amountCents: expense.amountCents,
    taxCents: expense.taxCents,
    currency: expense.currency,
    spentAt: expense.spentAt.toISOString().slice(0, 10),
    notes: expense.notes,
    createdAt: expense.createdAt.toISOString(),
    // A row predating the backfill would otherwise serialise with no lines at
    // all, which the UI has no way to render. Falling back to the deprecated
    // columns keeps such a row readable until the backfill runs.
    lines:
      lines.length > 0
        ? lines.map(serialiseLine)
        : [
            {
              id: `${expense.id}-legacy`,
              label: null,
              amountCents: expense.amountCents,
              category: isCategoryId(expense.category) ? expense.category : 'OTHER',
              categoryConfidence: expense.categoryConfidence ?? 0,
              categorySource: expense.categorySource === 'manual' ? 'manual' : 'auto',
              position: 0,
            },
          ],
  };
}
