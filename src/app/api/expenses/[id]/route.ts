import type { Prisma } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { parseDateOnly } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { serialiseExpense } from '@/lib/expenses/serialise';
import { updateExpenseSchema } from '@/lib/validation';
import type { ExpenseDto } from '@/types';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withRoute(async (request: Request, context: RouteContext) => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.write, user.id);

  const { id } = await context.params;

  const parsed = updateExpenseSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const input = parsed.data;

  const data: Prisma.ExpenseUpdateManyMutationInput = {};
  if (input.merchant !== undefined) data.merchant = input.merchant;
  if (input.amountCents !== undefined) data.amountCents = input.amountCents;
  if (input.taxCents !== undefined) data.taxCents = input.taxCents;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.spentAt !== undefined) {
    const spentAt = parseDateOnly(input.spentAt);
    if (!spentAt) throw validationFailed({ spentAt: 'That date is not valid.' });
    data.spentAt = spentAt;
  }

  // `updateMany` with the userId in the filter means another artist's id in the
  // URL updates nothing rather than 404-ing after a successful read.
  const result = await prisma.expense.updateMany({ where: { id, userId: user.id }, data });
  if (result.count === 0) throw notFound('That expense no longer exists.');

  // Lines are replaced wholesale rather than diffed: the split is a single
  // decision, and a partial application of it could leave the parts not adding
  // up to the total. The delete and the re-create share one transaction so
  // that window never exists.
  if (input.lines !== undefined) {
    const lines = input.lines;
    await prisma.$transaction([
      prisma.expenseLine.deleteMany({ where: { expenseId: id } }),
      prisma.expenseLine.createMany({
        data: lines.map((line, position) => ({
          expenseId: id,
          label: line.label ?? null,
          amountCents: line.amountCents,
          category: line.category,
          // A hand-picked category is authoritative: mark it so the
          // classifier's guess is never shown as the artist's own choice, and
          // so a future re-parse leaves it alone.
          categoryConfidence: line.categorySource === 'manual' ? 1 : line.categoryConfidence,
          categorySource: line.categorySource,
          position,
        })),
      }),
    ]);
  }

  const expense = await prisma.expense.findFirst({
    where: { id, userId: user.id },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (!expense) throw notFound('That expense no longer exists.');

  return jsonOk<{ expense: ExpenseDto }>({ expense: serialiseExpense(expense) });
});

export const DELETE = withRoute(async (_request: Request, context: RouteContext) => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.write, user.id);

  const { id } = await context.params;

  const result = await prisma.expense.deleteMany({ where: { id, userId: user.id } });
  if (result.count === 0) throw notFound('That expense no longer exists.');

  return jsonOk({ ok: true });
});
