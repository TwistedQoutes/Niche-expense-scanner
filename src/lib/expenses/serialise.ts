import type { Expense } from '@prisma/client';

import { isCategoryId } from '@/lib/categories/taxonomy';
import type { ExpenseDto } from '@/types';

/**
 * Single conversion point from database row to API payload.
 *
 * `category` and `categorySource` are stored as strings (portable across
 * SQLite and Postgres, and migration-free when the taxonomy grows), so they are
 * narrowed back to their union types here rather than being cast at each use.
 */
export function serialiseExpense(expense: Expense): ExpenseDto {
  return {
    id: expense.id,
    merchant: expense.merchant,
    amountCents: expense.amountCents,
    taxCents: expense.taxCents,
    currency: expense.currency,
    spentAt: expense.spentAt.toISOString().slice(0, 10),
    category: isCategoryId(expense.category) ? expense.category : 'OTHER',
    categoryConfidence: expense.categoryConfidence,
    categorySource: expense.categorySource === 'manual' ? 'manual' : 'auto',
    notes: expense.notes,
    createdAt: expense.createdAt.toISOString(),
  };
}
