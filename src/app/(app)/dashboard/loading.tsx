import { Skeleton, SkeletonRows } from '@/components/ui/Skeleton';

/**
 * Shown while the dashboard's queries run.
 *
 * Shaped like the real page rather than a spinner, so the layout does not jump
 * when the numbers land.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      <Skeleton className="h-7 w-52" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-2xl" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
          <SkeletonRows rows={4} />
        </div>
        <div className="rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
          <SkeletonRows rows={4} />
        </div>
      </div>
    </div>
  );
}
