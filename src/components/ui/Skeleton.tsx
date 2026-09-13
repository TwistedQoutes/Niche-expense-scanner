import { cn } from '@/lib/cn';

/**
 * A loading placeholder shaped like the content it replaces.
 *
 * Shaped, not generic: a spinner in the middle of a dashboard tells the user
 * nothing and makes the layout jump when data lands. A block the size of the
 * eventual row keeps the page still.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800', className)}
    />
  );
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2 p-4', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  );
}
