import { validationFailed } from '@/lib/api/errors';
import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { requireUser } from '@/lib/auth/current-user';
import { categoryOf } from '@/lib/categories/taxonomy';
import { UTF8_BOM, csvFilename, toCsv } from '@/lib/csv';
import { formatMonthLabel, isMonthKey } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { expenseWhere } from '@/lib/expenses/queries';
import { centsToDecimalString } from '@/lib/money';
import { monthQuerySchema } from '@/lib/validation';

export const runtime = 'nodejs';

const HEADERS = [
  'Date',
  'Merchant',
  'Category',
  'Amount',
  'Tax',
  'Currency',
  'Schedule C line',
  'Categorised by',
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
    orderBy: [{ spentAt: 'asc' }, { createdAt: 'asc' }],
    take: MAX_ROWS,
  });

  const rows = expenses.map((expense) => {
    const category = categoryOf(expense.category);
    return [
      expense.spentAt.toISOString().slice(0, 10),
      expense.merchant,
      category.label,
      centsToDecimalString(expense.amountCents),
      expense.taxCents === null ? '' : centsToDecimalString(expense.taxCents),
      expense.currency,
      category.scheduleC,
      expense.categorySource === 'manual' ? 'Artist' : 'Scanner',
      expense.notes ?? '',
    ];
  });

  const totalCents = expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const taxTotalCents = expenses.reduce((sum, expense) => sum + (expense.taxCents ?? 0), 0);

  // A totals row: the first thing anyone does with this file is check the sum.
  const body = toCsv(HEADERS, [
    ...rows,
    [],
    ['', 'TOTAL', '', centsToDecimalString(totalCents), centsToDecimalString(taxTotalCents), '', '', '', ''],
    [
      '',
      `${expenses.length} expense${expenses.length === 1 ? '' : 's'}${
        month ? ` — ${formatMonthLabel(month)}` : ' — all time'
      }`,
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
