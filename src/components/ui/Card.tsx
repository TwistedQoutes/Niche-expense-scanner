import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The surface everything sits on.
 *
 * A ring rather than a border, and a shadow so slight it is easier to notice
 * when it is removed than when it is there. That restraint is deliberate: a card
 * in a dense operational tool is a container, not an object to be admired, and
 * heavy shadows on every panel are the fastest way to make a screen look like a
 * template. What the shadow buys is separation from the page behind it — enough
 * that the eye groups the contents, not enough to announce itself.
 */
export function Card({
  className,
  interactive = false,
  children,
}: {
  className?: string;
  /** For a card that is itself a link or a button. */
  interactive?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white shadow-xs ring-1 ring-slate-200/80',
        'dark:bg-slate-900 dark:shadow-none dark:ring-slate-800',
        interactive &&
          'transition-[box-shadow,border-color] duration-150 ease-out hover:shadow-sm hover:ring-slate-300 dark:hover:ring-slate-700',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
