import type { Prisma } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { parseDateOnly } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { serialiseExpense } from '@/lib/expenses/serialise';
import { isValidImageKey, resolveStorage } from '@/lib/storage';
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

  const data: Prisma.ExpenseUpdateInput = {};
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

  // The whole update runs in one interactive transaction, and it starts by
  // taking a row lock on the expense.
  //
  // Without the lock, two concurrent edits of the same receipt interleave: each
  // deletes the lines it can see and inserts its own, and both sets survive.
  // That produces a receipt whose parts do not add up to its total — the exact
  // invariant the rest of the code works to preserve. `FOR UPDATE` makes the
  // second request wait for the first to commit, so the loser overwrites the
  // winner cleanly instead of merging with it.
  //
  // The lock is scoped by userId as well as id, so another artist's id in the
  // URL locks nothing and falls through to the 404 below.
  const expense = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM expenses WHERE id = ${id} AND "userId" = ${user.id} FOR UPDATE
    `;
    if (locked.length === 0) return null;

    if (Object.keys(data).length > 0) {
      await tx.expense.update({ where: { id }, data });
    }

    // Lines are replaced wholesale rather than diffed: the split is a single
    // decision, and applying half of it would leave the parts disagreeing with
    // the total.
    if (input.lines !== undefined) {
      const lines = input.lines;

      await tx.expenseLine.deleteMany({ where: { expenseId: id } });
      await tx.expenseLine.createMany({
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
      });
    }

    return tx.expense.findFirst({
      where: { id, userId: user.id },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
  });

  if (!expense) throw notFound('That expense no longer exists.');

  return jsonOk<{ expense: ExpenseDto }>({ expense: serialiseExpense(expense) });
});

export const DELETE = withRoute(async (_request: Request, context: RouteContext) => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.write, user.id);

  const { id } = await context.params;

  // The image key has to be read before the row goes: the database cascade
  // reaches ExpenseLine but knows nothing about files on disk, so without this
  // every deleted receipt would leave its image behind forever.
  const existing = await prisma.expense.findFirst({
    where: { id, userId: user.id },
    select: { imageKey: true },
  });

  const result = await prisma.expense.deleteMany({ where: { id, userId: user.id } });
  if (result.count === 0) throw notFound('That expense no longer exists.');

  if (existing?.imageKey && isValidImageKey(existing.imageKey)) {
    const storage = resolveStorage();
    // Best effort: the expense is already gone as far as the artist is
    // concerned, and failing the request would suggest otherwise.
    await storage?.delete(existing.imageKey).catch((error: unknown) => {
      console.error('[expense] deleted the row but could not remove its image', {
        expenseId: id,
        error,
      });
    });
  }

  return jsonOk({ ok: true });
});
