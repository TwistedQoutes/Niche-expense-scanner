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

  return (
    // Two-up on a phone, four across once there is room for them.
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
  );
}
