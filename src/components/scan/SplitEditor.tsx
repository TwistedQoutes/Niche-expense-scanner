'use client';

import { Button } from '@/components/ui/Button';
import { CATEGORY_LIST, type CategoryId } from '@/lib/categories/taxonomy';
import { cn } from '@/lib/cn';
import { formatCents, parseAmountToCents } from '@/lib/money';
import { MAX_EXPENSE_LINES } from '@/lib/validation';

/** A split line as the artist is editing it — the amount stays a string until save. */
export type DraftLine = {
  key: string;
  label: string;
  amount: string;
  category: CategoryId;
};

export function newDraftLine(category: CategoryId = 'OTHER', amount = '', label = ''): DraftLine {
  return {
    // A stable key so React does not remount every row when one is deleted,
    // which would drop focus mid-typing.
    key: crypto.randomUUID(),
    label,
    amount,
    category,
  };
}

/** Sum of the parts, in cents. Unparseable rows count as zero. */
export function draftLinesTotal(lines: readonly DraftLine[]): number {
  return lines.reduce((sum, line) => sum + (parseAmountToCents(line.amount) ?? 0), 0);
}

/**
 * The split editor.
 *
 * The whole design turns on one number: **what is left to account for**. A
 * split that does not add up to the receipt total is rejected on save, so
 * rather than let an artist discover that after pressing the button, the
 * remainder is shown live and the shortfall can be dropped onto a line in one
 * tap.
 */
export function SplitEditor({
  lines,
  totalCents,
  currency,
  error,
  onChange,
}: {
  lines: DraftLine[];
  totalCents: number | null;
  currency: string;
  error?: string;
  onChange: (lines: DraftLine[]) => void;
}) {
  const allocated = draftLinesTotal(lines);
  const remaining = totalCents === null ? null : totalCents - allocated;
  const balanced = remaining === 0;

  function update(key: string, patch: Partial<DraftLine>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function remove(key: string) {
    onChange(lines.filter((line) => line.key !== key));
  }

  function addLine() {
    if (lines.length >= MAX_EXPENSE_LINES) return;
    // Pre-fill the new row with whatever is unaccounted for: the common case is
    // "the rest of this receipt was gloves".
    const prefill = remaining !== null && remaining > 0 ? (remaining / 100).toFixed(2) : '';
    onChange([...lines, newDraftLine('OTHER', prefill)]);
  }

  /** Drops the entire remainder onto one line. */
  function absorbRemainder(key: string) {
    if (remaining === null || remaining === 0) return;
    const line = lines.find((candidate) => candidate.key === key);
    if (!line) return;

    const current = parseAmountToCents(line.amount) ?? 0;
    const next = current + remaining;
    if (next <= 0) return;

    update(key, { amount: (next / 100).toFixed(2) });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {lines.map((line, index) => (
          <div
            key={line.key}
            className="space-y-2 rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200 dark:bg-zinc-800/40 dark:ring-zinc-800"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Part {index + 1}
              </span>
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => remove(line.key)}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Remove
                </button>
              ) : null}
            </div>

            <select
              value={line.category}
              onChange={(event) => update(line.key, { category: event.target.value as CategoryId })}
              aria-label={`Category for part ${index + 1}`}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700"
            >
              {CATEGORY_LIST.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>

            <div className="flex gap-2">
              <input
                value={line.label}
                onChange={(event) => update(line.key, { label: event.target.value })}
                placeholder="What it was (optional)"
                aria-label={`Description for part ${index + 1}`}
                className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-zinc-200 placeholder:text-zinc-400 dark:bg-zinc-900 dark:ring-zinc-700"
              />
              <input
                value={line.amount}
                onChange={(event) => update(line.key, { amount: event.target.value })}
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Amount for part ${index + 1}`}
                className="tabular w-24 shrink-0 rounded-lg bg-white px-3 py-2 text-right text-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700"
              />
            </div>

            {remaining !== null && remaining !== 0 ? (
              <button
                type="button"
                onClick={() => absorbRemainder(line.key)}
                className="text-brand-600 dark:text-brand-400 text-xs font-medium hover:underline"
              >
                {remaining > 0
                  ? `Add the remaining ${formatCents(remaining, currency)} here`
                  : `Take ${formatCents(-remaining, currency)} off this part`}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={addLine}
          disabled={lines.length >= MAX_EXPENSE_LINES}
        >
          + Add a category
        </Button>

        {remaining !== null ? (
          <p
            // Announced politely so a screen-reader user hears the balance
            // update rather than only seeing it.
            role="status"
            className={cn(
              'tabular text-sm font-medium',
              balanced
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400',
            )}
          >
            {balanced
              ? 'Adds up ✓'
              : remaining > 0
                ? `${formatCents(remaining, currency)} left`
                : `${formatCents(-remaining, currency)} over`}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
