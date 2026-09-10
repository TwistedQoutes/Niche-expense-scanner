'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { CATEGORY_LIST, type CategoryId } from '@/lib/categories/taxonomy';
import { formatDateLabel } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import type { ExpenseDto } from '@/types';

/**
 * The expense log.
 *
 * Mobile gets a stack of rows — a real <table> at 360px means horizontal
 * scrolling, which is where expense trackers become unusable on a phone. From
 * `sm` up the same data is laid out on a grid with column headers, so a desktop
 * user gets the scannable table they expect. One component, one source of
 * truth, two layouts.
 */
export function ExpenseTable({
  expenses,
  onRecategorise,
  onDelete,
  busyId,
}: {
  expenses: ExpenseDto[];
  /**
   * Re-categorises one part of a receipt. `lineId` identifies which — a split
   * receipt has several, and changing "the category" of the whole thing is not
   * a meaningful operation.
   */
  onRecategorise: (expenseId: string, lineId: string, category: CategoryId) => void;
  onDelete: (id: string) => void;
  busyId: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Card className="overflow-hidden">
      {/* Column headers, desktop only. */}
      <div className="hidden border-b border-zinc-100 px-4 py-2.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase sm:grid sm:grid-cols-[6rem_1fr_11rem_6.5rem] sm:gap-3 dark:border-zinc-800 dark:text-zinc-400">
        <span>Date</span>
        <span>Merchant</span>
        <span>Category</span>
        <span className="text-right">Amount</span>
      </div>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {expenses.map((expense) => {
          const expanded = expandedId === expense.id;
          const busy = busyId === expense.id;

          return (
            <li key={expense.id} className={busy ? 'opacity-50' : undefined}>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : expense.id)}
                aria-expanded={expanded}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-zinc-50 sm:grid sm:grid-cols-[6rem_1fr_11rem_6.5rem] sm:items-center sm:gap-3 dark:hover:bg-zinc-800/50"
              >
                {/* Mobile: two lines. Desktop: four columns. */}
                <span className="tabular hidden text-sm text-zinc-500 sm:block dark:text-zinc-400">
                  {formatDateLabel(new Date(`${expense.spentAt}T00:00:00Z`))}
                </span>

                <span className="flex min-w-0 items-center justify-between gap-3 sm:block">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{expense.merchant}</span>
                    <span className="tabular block text-xs text-zinc-500 sm:hidden dark:text-zinc-400">
                      {formatDateLabel(new Date(`${expense.spentAt}T00:00:00Z`))}
                    </span>
                  </span>
                  <span className="tabular shrink-0 font-semibold sm:hidden">
                    {formatCents(expense.amountCents, expense.currency)}
                  </span>
                </span>

                <span className="mt-1.5 block sm:mt-0">
                  {expense.lines.length === 1 ? (
                    <CategoryChip
                      category={expense.lines[0]!.category}
                      showSource
                      source={expense.lines[0]!.categorySource}
                    />
                  ) : (
                    // A split shows its categories as stacked chips rather than
                    // a count: which categories is the useful information, and
                    // "3 categories" makes you tap to find out.
                    <span className="flex flex-wrap gap-1">
                      {expense.lines.slice(0, 3).map((line) => (
                        <CategoryChip key={line.id} category={line.category} />
                      ))}
                      {expense.lines.length > 3 ? (
                        <span className="self-center text-xs text-zinc-500 dark:text-zinc-400">
                          +{expense.lines.length - 3}
                        </span>
                      ) : null}
                    </span>
                  )}
                </span>

                <span className="tabular hidden text-right font-semibold sm:block">
                  {formatCents(expense.amountCents, expense.currency)}
                </span>
              </button>

              {expanded ? (
                <div className="space-y-3 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/30">
                  {expense.notes ? (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{expense.notes}</p>
                  ) : null}

                  {expense.taxCents !== null ? (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      Includes {formatCents(expense.taxCents, expense.currency)} tax
                    </p>
                  ) : null}

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {expense.lines.length === 1
                        ? 'Change category'
                        : `Split ${expense.lines.length} ways — change any part`}
                    </p>

                    {expense.lines.map((line) => (
                      <div key={line.id} className="space-y-1">
                        {expense.lines.length > 1 ? (
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate text-zinc-600 dark:text-zinc-400">
                              {line.label ?? 'Part of this receipt'}
                            </span>
                            <span className="tabular shrink-0 font-medium">
                              {formatCents(line.amountCents, expense.currency)}
                            </span>
                          </div>
                        ) : null}
                        <select
                          value={line.category}
                          disabled={busy}
                          aria-label={
                            line.label
                              ? `Category for ${line.label}`
                              : `Category for the ${expense.merchant} expense`
                          }
                          onChange={(event) =>
                            onRecategorise(expense.id, line.id, event.target.value as CategoryId)
                          }
                          className="w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700"
                        >
                          {CATEGORY_LIST.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => onDelete(expense.id)}
                  >
                    Delete expense
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
