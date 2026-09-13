import { chartThemeCss } from '@/components/charts/palette';

/**
 * A ranked list of nominal categories — lead sources, services — as one-colour bars.
 *
 * Deliberately **one colour for every bar**. Shading each bar darker-where-bigger
 * would double-encode length as hue: it spends the only free channel on
 * information the bar already carries, and implies an order these categories do
 * not have. Sources are not ranked stages; they are just names.
 *
 * The value beside each label is the point of the list, so it is always visible
 * rather than living in a tooltip.
 */
export function BarList({
  rows,
  emptyMessage,
}: {
  rows: { key: string; label: string; value: number; display: string; secondary?: string }[];
  emptyMessage: string;
}) {
  const scope = 'viz-barlist';
  const peak = Math.max(...rows.map((row) => row.value), 0);

  if (rows.length === 0 || peak === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={`${scope} space-y-2.5`}>
      <style>{chartThemeCss(scope)}</style>

      {rows.map((row) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700 dark:text-slate-300">{row.label}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="tabular font-medium text-slate-900 dark:text-slate-100">
                {row.display}
              </span>
              {row.secondary ? (
                <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                  {row.secondary}
                </span>
              ) : null}
            </span>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-r-[4px]"
              style={{
                width: `${Math.max((row.value / peak) * 100, row.value > 0 ? 2 : 0)}%`,
                backgroundColor: 'var(--viz-accent)',
              }}
              role="img"
              aria-label={`${row.label}: ${row.display}`}
              title={`${row.label}: ${row.display}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
