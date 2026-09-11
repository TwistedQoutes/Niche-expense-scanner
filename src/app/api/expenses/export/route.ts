import { validationFailed } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { requireUser } from '@/lib/auth/current-user';
import { categoryOf } from '@/lib/categories/taxonomy';
import { UTF8_BOM, csvFilename, toCsv } from '@/lib/csv';
import { formatMonthLabel, isMonthKey } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { expenseWhere } from '@/lib/expenses/queries';
import { serialiseExpense } from '@/lib/expenses/serialise';
import { centsToDecimalString, totalsByCurrency } from '@/lib/money';
import { monthQuerySchema } from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * One row per category share, not per receipt.
 *
 * A split receipt belongs on two or three Schedule C lines, so emitting it as a
 * single row would force whoever files the return to unpick it by hand — which
 * is the work this feature exists to remove. `Part of receipt` names the parent
 * so the rows can still be traced back to one document.
 */
const HEADERS = [
  'Date',
  'Merchant',
  'Description',
  'Category',
  'Amount',
  'Currency',
  'Schedule C line',
  'Categorised by',
  'Part of receipt',
  'Receipt total',
  'Tax',
  'Notes',
] as const;

/** Hard cap on one export, so a huge account cannot exhaust server memory. */
const MAX_ROWS = 10_000;

/**
 * Streams the current filter selection out as a spreadsheet.
 *
 * `?month=YYYY-MM` exports one month (what the dashboard button sends);
 * omitting it exports everything, which is what an artist wants at tax time.
 */
export const GET = withRoute(async (request) => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.export, user.id);

  const monthParam = new URL(request.url).searchParams.get('month');

  let month: string | undefined;
  if (monthParam) {
    const parsed = monthQuerySchema.safeParse(monthParam);
    if (!parsed.success) throw validationFailed({ month: 'Month must look like 2026-09.' });
    month = parsed.data;
  }

  const expenses = await prisma.expense.findMany({
    where: expenseWhere(user.id, month && isMonthKey(month) ? { month } : {}),
    include: { lines: { orderBy: { position: 'asc' } } },
    orderBy: [{ spentAt: 'asc' }, { createdAt: 'asc' }],
    take: MAX_ROWS,
  });

  const rows = expenses.flatMap((expense) => {
    const serialised = serialiseExpense(expense);
    const split = serialised.lines.length > 1;

    return serialised.lines.map((line, index) => {
      const category = categoryOf(line.category);
      return [
        serialised.spentAt,
        expense.merchant,
        line.label ?? '',
        category.label,
        centsToDecimalString(line.amountCents),
        expense.currency,
        category.scheduleC,
        line.categorySource === 'manual' ? 'Artist' : 'Scanner',
        split ? `${index + 1} of ${serialised.lines.length}` : '',
        // Repeating the receipt total on every row of a split would double-count
        // it in a naive sum, so it is stated once, against the first part.
        index === 0 ? centsToDecimalString(expense.amountCents) : '',
        index === 0 && expense.taxCents !== null ? centsToDecimalString(expense.taxCents) : '',
        index === 0 ? (expense.notes ?? '') : '',
      ];
    });
  });

  // One totals row per currency. A single row summing every receipt would add
  // pounds to dollars and print the result as if it were money — the kind of
  // number that gets copied onto a tax return without anyone noticing.
  const totals = totalsByCurrency(expenses);
  const mixed = totals.length > 1;

  const totalRows = totals.map((sums) => [
    '',
    mixed ? `TOTAL (${sums.currency})` : 'TOTAL',
    '',
    '',
    centsToDecimalString(sums.totalCents),
    sums.currency,
    '',
    '',
    '',
    centsToDecimalString(sums.totalCents),
    centsToDecimalString(sums.taxCents),
    mixed ? `${sums.receipts} receipt${sums.receipts === 1 ? '' : 's'}` : '',
  ]);

  // A totals row: the first thing anyone does with this file is check the sum.
  // Because the sum invariant holds, totalling the per-line Amount column gives
  // the same figure as totalling the receipts — so the file reconciles whether
  // it is read by row or by receipt.
  const body = toCsv(HEADERS, [
    ...rows,
    [],
    ...totalRows,
    [
      '',
      `${expenses.length} receipt${expenses.length === 1 ? '' : 's'} in ${rows.length} ${
        rows.length === 1 ? 'part' : 'parts'
      }${month ? ` — ${formatMonthLabel(month)}` : ' — all time'}`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'Schedule C lines are general guidance, not tax advice.',
    ],
  ]);

  return new Response(`${UTF8_BOM}${body}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(month ?? 'all-time')}"`,
      'Cache-Control': 'no-store',
      // The browser must not sniff this into something scriptable.
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
