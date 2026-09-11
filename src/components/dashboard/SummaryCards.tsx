import { Card } from '@/components/ui/Card';
import { formatCents } from '@/lib/money';
import type { MonthSummary } from '@/types';

export function SummaryCards({ summary }: { summary: MonthSummary }) {
  const average = summary.count > 0 ? Math.round(summary.totalCents / summary.count) : 0;

  const tiles = [
    { label: 'Total spend', value: formatCents(summary.totalCents, summary.currency), emphasis: true },
    { label: 'Receipts', value: String(summary.count) },
    { label: 'Average', value: formatCents(average, summary.currency) },
    { label: 'Sales tax', value: formatCents(summary.taxCents, summary.currency) },
  ];

  // Everything above describes `summary.currency`. Anything spent in another
  // currency is named explicitly rather than folded into the headline figure,
  // because a total that silently mixes currencies is simply wrong.
  const others = summary.byCurrency.filter((entry) => entry.currency !== summary.currency);

  return (
    <div className="space-y-2">
      {/* Two-up on a phone, four across once there is room for them. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label} className="px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              {tile.label}
            </p>
            <p
              className={
                tile.emphasis
                  ? 'tabular mt-1 text-xl font-bold tracking-tight'
                  : 'tabular mt-1 text-lg font-semibold'
              }
            >
              {tile.value}
            </p>
          </Card>
        ))}
      </div>

      {others.length > 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Totals above are in {summary.currency}. Also this month:{' '}
          {others
            .map(
              (entry) =>
                `${formatCents(entry.totalCents, entry.currency)} across ${entry.count} ${
                  entry.count === 1 ? 'receipt' : 'receipts'
                }`,
            )
            .join(', ')}
          .
        </p>
      )}
    </div>
  );
}
