import type { Prisma } from '@prisma/client';

import { CATEGORY_IDS, isCategoryId, type CategoryId } from '@/lib/categories/taxonomy';
import { monthRange, type MonthKey } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { serialiseExpense } from '@/lib/expenses/serialise';
import type { ExpenseDto, MonthSummary } from '@/types';

export type ExpenseFilters = {
  month?: MonthKey;
  category?: CategoryId;
  search?: string;
};

/**
 * Builds the `where` clause for a listing.
 *
 * `userId` is applied here, not by the caller, so there is exactly one place
 * that decides scoping — the shape of bug where one endpoint forgets the filter
 * and leaks another artist's expenses simply cannot occur.
 */
export function expenseWhere(userId: string, filters: ExpenseFilters): Prisma.ExpenseWhereInput {
  const where: Prisma.ExpenseWhereInput = { userId };

  if (filters.month) {
    const { start, end } = monthRange(filters.month);
    where.spentAt = { gte: start, lt: end };
  }

  if (filters.category) {
    where.category = filters.category;
  }

  if (filters.search) {
    // SQLite's `contains` is case-insensitive for ASCII by default; on Postgres
    // add `mode: 'insensitive'` here.
    where.OR = [{ merchant: { contains: filters.search } }, { notes: { contains: filters.search } }];
  }

  return where;
}

export async function listExpenses(
  userId: string,
  filters: ExpenseFilters,
  pagination: { limit: number; cursor?: string },
): Promise<{ expenses: ExpenseDto[]; nextCursor: string | null }> {
  // Fetch one extra row to discover whether another page exists without a
  // second count query.
  const rows = await prisma.expense.findMany({
    where: expenseWhere(userId, filters),
    orderBy: [{ spentAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
    ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > pagination.limit;
  const page = hasMore ? rows.slice(0, pagination.limit) : rows;

  return {
    expenses: page.map(serialiseExpense),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Month totals, aggregated in the database rather than over a fetched page —
 * the summary must describe the whole month even when the table is paginated.
 */
export async function summariseMonth(userId: string, month: MonthKey): Promise<MonthSummary> {
  const where = expenseWhere(userId, { month });

  const [totals, grouped, currencyRow] = await Promise.all([
    prisma.expense.aggregate({ where, _sum: { amountCents: true, taxCents: true }, _count: true }),
    prisma.expense.groupBy({
      by: ['category'],
      where,
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.expense.findFirst({ where, select: { currency: true }, orderBy: { createdAt: 'desc' } }),
  ]);

  const byCategory = grouped
    .map((group) => ({
      category: isCategoryId(group.category) ? group.category : ('OTHER' as CategoryId),
      totalCents: group._sum.amountCents ?? 0,
      count: group._count,
    }))
    .sort(
      (a, b) =>
        b.totalCents - a.totalCents ||
        CATEGORY_IDS.indexOf(a.category) - CATEGORY_IDS.indexOf(b.category),
    );

  return {
    month,
    totalCents: totals._sum.amountCents ?? 0,
    taxCents: totals._sum.taxCents ?? 0,
    count: totals._count,
    byCategory,
    currency: currencyRow?.currency ?? 'USD',
  };
}

/** Months that actually contain expenses, so the filter never offers an empty one. */
export async function monthsWithExpenses(userId: string): Promise<MonthKey[]> {
  const rows = await prisma.expense.findMany({
    where: { userId },
    select: { spentAt: true },
    orderBy: { spentAt: 'desc' },
    // A generous cap: enough for years of history, bounded so a pathological
    // account cannot pull an unbounded result set into memory.
    take: 5_000,
  });

  const months = new Set<MonthKey>();
  for (const row of rows) {
    months.add(row.spentAt.toISOString().slice(0, 7));
  }

  return [...months].sort().reverse();
}
