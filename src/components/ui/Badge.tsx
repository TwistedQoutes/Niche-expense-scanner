import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Status colour is semantic across the whole app.
 *
 * The same amber means "waiting on the customer" on a quote, on the pipeline
 * board and in the dashboard tile. An owner should be able to read the state of
 * their business at a glance, which only works if a colour means one thing
 * everywhere — so tones are named by meaning, not by hue.
 */
export type BadgeTone =
  | 'neutral'
  | 'info'
  /** In progress, waiting on us. */
  | 'active'
  /** Waiting on the customer. */
  | 'pending'
  /** Won, paid, completed. */
  | 'success'
  /** Lost, declined, cancelled. */
  | 'danger'
  /** Needs attention now — overdue, expiring, emergency. */
  | 'urgent';

const TONES: Record<BadgeTone, string> = {
  neutral:
    'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  info: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:ring-sky-900',
  active:
    'bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-200 dark:ring-indigo-900',
  pending:
    'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-900',
  success:
    'bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-950/60 dark:text-brand-200 dark:ring-brand-900',
  danger:
    'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/60 dark:text-red-200 dark:ring-red-900',
  urgent:
    'bg-orange-100 text-orange-900 ring-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:ring-orange-900',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small filled circle, for legends and dense table cells. */
export function Dot({ tone = 'neutral', className }: { tone?: BadgeTone; className?: string }) {
  const FILL: Record<BadgeTone, string> = {
    neutral: 'bg-slate-400',
    info: 'bg-sky-500',
    active: 'bg-indigo-500',
    pending: 'bg-amber-500',
    success: 'bg-brand-500',
    danger: 'bg-red-500',
    urgent: 'bg-orange-500',
  };

  return <span aria-hidden="true" className={cn('size-2 rounded-full', FILL[tone], className)} />;
}
