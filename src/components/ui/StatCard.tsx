import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * One number on the dashboard.
 *
 * The delta is signed and coloured by *meaning*, not by direction: more leads
 * is good and green, a longer response time is bad and red, and both can be a
 * rising number. `invertDelta` is what tells the two apart — without it the
 * dashboard cheerfully congratulates an owner for getting slower.
 */
export function StatCard({
  label,
  value,
  hint,
  deltaPercent,
  invertDelta = false,
  icon,
  href,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Change against the previous period. Omit when there is nothing to compare. */
  deltaPercent?: number | null;
  /** True when a rise is bad — response time, lost quotes. */
  invertDelta?: boolean;
  icon?: ReactNode;
  href?: string;
  className?: string;
}) {
  const hasDelta = typeof deltaPercent === 'number' && Number.isFinite(deltaPercent);
  const isGood = hasDelta ? (invertDelta ? deltaPercent < 0 : deltaPercent > 0) : false;
  const isFlat = hasDelta && Math.round(deltaPercent) === 0;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {icon ? <span className="text-slate-400 dark:text-slate-500">{icon}</span> : null}
      </div>

      <p className="tabular mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">
        {value}
      </p>

      <div className="mt-1 flex items-center gap-2">
        {hasDelta ? (
          <span
            className={cn(
              'tabular text-xs font-medium',
              isFlat
                ? 'text-slate-500 dark:text-slate-400'
                : isGood
                  ? 'text-brand-700 dark:text-brand-400'
                  : 'text-red-600 dark:text-red-400',
            )}
          >
            {deltaPercent > 0 ? '+' : ''}
            {Math.round(deltaPercent)}%
          </span>
        ) : null}
        {hint ? <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span> : null}
      </div>
    </>
  );

  const shell = cn(
    'rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800',
    href && 'transition-colors duration-150 ease-out hover:bg-slate-50 dark:hover:bg-slate-800/60',
    className,
  );

  if (href) {
    return (
      <a href={href} className={shell}>
        {body}
      </a>
    );
  }

  return <div className={shell}>{body}</div>;
}
