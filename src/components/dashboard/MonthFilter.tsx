'use client';

import { cn } from '@/lib/cn';
import { formatMonthLabel, recentMonthKeys } from '@/lib/dates';

/**
 * Horizontally scrolling month picker.
 *
 * Months that already contain expenses come first, then a rolling window of
 * recent months so a receipt from a quiet month can still be filed and found.
 */
export function MonthFilter({
  value,
  available,
  onChange,
}: {
  value: string;
  available: string[];
  onChange: (month: string) => void;
}) {
  const months = [...new Set([...available, ...recentMonthKeys(12), value])].sort().reverse().slice(0, 24);

  return (
    <div
      className="no-scrollbar -mx-4 overflow-x-auto px-4"
      role="group"
      aria-label="Filter expenses by month"
    >
      <div className="flex gap-2 pb-1">
        {months.map((month) => {
          const selected = month === value;
          return (
            <button
              key={month}
              type="button"
              onClick={() => onChange(month)}
              aria-pressed={selected}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                selected
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800',
              )}
            >
              {formatMonthLabel(month)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
