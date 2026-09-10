import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { requireWriteAccess } from '@/lib/billing/guard';
import { currentMonthKey, parseDateOnly } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { listExpenses, summariseMonth } from '@/lib/expenses/queries';
import { serialiseExpense } from '@/lib/expenses/serialise';
import { createExpenseSchema, listExpensesQuerySchema } from '@/lib/validation';
import type { ExpenseDto, ExpenseListResponse } from '@/types';

export const runtime = 'nodejs';

export const GET = withRoute(async (request) => {
  const user = await requireUser();

  const url = new URL(request.url);
  const parsed = listExpensesQuerySchema.safeParse({
    month: url.searchParams.get('month') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const month = parsed.data.month ?? currentMonthKey();

  const [{ expenses, nextCursor }, summary] = await Promise.all([
    listExpenses(
      user.id,
      { month, category: parsed.data.category, search: parsed.data.search },
      { limit: parsed.data.limit, cursor: parsed.data.cursor },
    ),
    summariseMonth(user.id, month),
  ]);

  return jsonOk<ExpenseListResponse>({ expenses, summary, nextCursor });
});

export const POST = withRoute(async (request) => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.write, user.id);
  requireWriteAccess(user);

  const parsed = createExpenseSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const input = parsed.data;
  const spentAt = parseDateOnly(input.spentAt);
  if (!spentAt) throw validationFailed({ spentAt: 'That date is not valid.' });

  const expense = await prisma.expense.create({
    data: {
      userId: user.id,
      merchant: input.merchant,
      amountCents: input.amountCents,
      taxCents: input.taxCents ?? null,
      currency: input.currency,
      spentAt,
      notes: input.notes ?? null,
      rawText: input.rawText ?? null,
      // Written in one statement with the expense, so a receipt can never exist
      // without the lines that account for its money.
      lines: {
        create: input.lines.map((line, position) => ({
          label: line.label ?? null,
          amountCents: line.amountCents,
          category: line.category,
          categoryConfidence: line.categoryConfidence,
          categorySource: line.categorySource,
          position,
        })),
      },
    },
    include: { lines: { orderBy: { position: 'asc' } } },
  });

  return jsonOk<{ expense: ExpenseDto }>({ expense: serialiseExpense(expense) }, { status: 201 });
});
