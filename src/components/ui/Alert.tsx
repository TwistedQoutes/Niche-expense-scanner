import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Tone = 'error' | 'warning' | 'info' | 'success';

const TONES: Record<Tone, string> = {
  error: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-900',
  warning:
    'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900',
  info: 'bg-brand-50 text-brand-900 ring-brand-200 dark:bg-brand-950/50 dark:text-brand-200 dark:ring-brand-900',
  success:
    'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900',
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      // Errors interrupt; everything else is announced politely when convenient.
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset', TONES[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && 'mt-0.5')}>{children}</div> : null}
    </div>
  );
}
