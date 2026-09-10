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

  const data: Record<string, unknown> = {};
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
  if (input.category !== undefined) {
    data.category = input.category;
    // A hand-picked category is authoritative: mark it so the classifier's
    // guess is never shown as if it were the artist's own choice, and so
    // future re-parses leave it alone.
    data.categorySource = 'manual';
    data.categoryConfidence = 1;
  }

  // `updateMany` with the userId in the filter means another artist's id in the
  // URL updates nothing rather than 404-ing after a successful read.
  const result = await prisma.expense.updateMany({ where: { id, userId: user.id }, data });
  if (result.count === 0) throw notFound('That expense no longer exists.');

  const expense = await prisma.expense.findFirst({ where: { id, userId: user.id } });
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
