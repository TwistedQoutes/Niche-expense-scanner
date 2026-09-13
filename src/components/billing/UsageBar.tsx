import { cn } from '@/lib/cn';

/**
 * One metric's allowance for the month.
 *
 * Amber from four fifths and red when it is gone, because the useful moment to
 * tell somebody they are running out of leads is before they run out — an owner
 * who discovers the ceiling by being refused has already lost the lead.
 */
export function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  /** null means unlimited. */
  limit: number | null;
}) {
  const unlimited = limit === null;
  const ratio = unlimited || limit === 0 ? 0 : Math.min(1, used / limit);
  const spent = !unlimited && used >= limit;
  const nearly = !unlimited && !spent && ratio >= 0.8;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
        <span
          className={cn(
            'tabular text-xs',
            spent
              ? 'text-red-600 dark:text-red-400'
              : nearly
                ? 'text-amber-700 dark:text-amber-500'
                : 'text-slate-500 dark:text-slate-400',
          )}
        >
          {unlimited ? `${used} · unlimited` : `${used} / ${limit}`}
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        {...(unlimited ? {} : { 'aria-valuemax': limit })}
        aria-label={label}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            spent ? 'bg-red-500' : nearly ? 'bg-amber-500' : 'bg-brand-500',
          )}
          style={{ width: unlimited ? '6%' : `${Math.max(ratio * 100, used > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  );
}
