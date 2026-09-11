import type { Prisma } from '@prisma/client';

import { CATEGORY_IDS, isCategoryId, type CategoryId } from '@/lib/categories/taxonomy';
import { monthRange, type MonthKey } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { serialiseExpense } from '@/lib/expenses/serialise';
import type { CurrencyTotal, ExpenseDto, MonthSummary } from '@/types';

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
    // Matches a receipt if *any* of its parts is in this category — a split
    // order of needles and ink belongs in both filters, not neither.
    where.lines = { some: { category: filters.category } };
  }

  if (filters.search) {
    // Postgres `LIKE` is case-sensitive, so searching "kingpin" would miss
    // "Kingpin Tattoo Supply" without this.
    where.OR = [
      { merchant: { contains: filters.search, mode: 'insensitive' } },
      { notes: { contains: filters.search, mode: 'insensitive' } },
    ];
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
    include: { lines: { orderBy: { position: 'asc' } } },
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

  // Totals come from the expense rows (so "receipts" counts receipts, not
  // parts), while the category breakdown comes from the lines. Both are
  // aggregated in the database, and the sum invariant guarantees they agree.
  //
  // Totals are grouped by currency because they have to be: adding £64.99 to
  // $123.40 produces a number that is not money in any currency, and it would
  // be shown on the dashboard and exported to an accountant as if it were.
  const currencyGroups = await prisma.expense.groupBy({
    by: ['currency'],
    where,
    _sum: { amountCents: true, taxCents: true },
    _count: true,
  });

  const byCurrency: CurrencyTotal[] = currencyGroups
    .map((group) => ({
      currency: group.currency,
      totalCents: group._sum.amountCents ?? 0,
      taxCents: group._sum.taxCents ?? 0,
      count: group._count,
    }))
    // Largest first, so the headline figures describe the currency the artist
    // actually works in rather than whichever row sorted first.
    .sort((a, b) => b.totalCents - a.totalCents || a.currency.localeCompare(b.currency));

  const primary = byCurrency[0] ?? null;

  // Scoped to the primary currency for the same reason as the totals: a
  // category row reading "Ink & Pigments 198.39" would be adding two
  // currencies together behind a single symbol.
  const grouped = primary
    ? await prisma.expenseLine.groupBy({
        by: ['category'],
        where: { expense: { ...where, currency: primary.currency } },
        _sum: { amountCents: true },
        _count: true,
      })
    : [];

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
    totalCents: primary?.totalCents ?? 0,
    taxCents: primary?.taxCents ?? 0,
    count: primary?.count ?? 0,
    byCategory,
    currency: primary?.currency ?? 'USD',
    byCurrency,
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
