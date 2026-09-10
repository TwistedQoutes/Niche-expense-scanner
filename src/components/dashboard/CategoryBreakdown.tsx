import { Card, CardHeader } from '@/components/ui/Card';
import { categoryOf } from '@/lib/categories/taxonomy';
import { formatCents } from '@/lib/money';
import type { MonthSummary } from '@/types';

/**
 * Where the month's money went.
 *
 * Bars rather than a pie chart: proportions are read off a shared baseline far
 * more accurately, it needs no charting library, and it stays legible at 360px
 * wide — which is where this will mostly be looked at.
 */
export function CategoryBreakdown({ summary }: { summary: MonthSummary }) {
  if (summary.byCategory.length === 0) return null;

  const largest = summary.byCategory[0]?.totalCents ?? 1;

  return (
    <Card>
      <CardHeader title="Where it went" description={`${summary.byCategory.length} ${summary.byCategory.length === 1 ? 'category' : 'categories'} this month`} />
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {summary.byCategory.map((entry) => {
          const definition = categoryOf(entry.category);
          const share = summary.totalCents > 0 ? entry.totalCents / summary.totalCents : 0;

          return (
            <li key={entry.category} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">{definition.label}</span>
                <span className="tabular shrink-0 text-sm font-semibold">
                  {formatCents(entry.totalCents, summary.currency)}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={`h-full rounded-full ${definition.barClass}`}
                    // Scaled against the largest category so small ones stay visible.
                    style={{ width: `${Math.max(2, (entry.totalCents / largest) * 100)}%` }}
                  />
                </div>
                <span className="tabular w-10 shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-400">
                  {Math.round(share * 100)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
