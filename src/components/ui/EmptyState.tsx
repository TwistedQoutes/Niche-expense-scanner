import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * What a screen shows before it has any data.
 *
 * Treated as a first-class state rather than an afterthought, because it is the
 * *first* thing every new customer sees on every screen. An empty table with no
 * explanation reads as a broken product; an empty state that names the next
 * action is onboarding.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="text-brand-600 dark:text-brand-400 flex size-11 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-950/60">
          {icon}
        </div>
      ) : null}

      <div className="max-w-sm space-y-1">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {description ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
        ) : null}
      </div>

      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
