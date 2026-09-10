/** Skeleton shown while the first month is fetched on the server. */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading expenses">
      <div className="h-7 w-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <div className="flex gap-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-10 w-28 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
        ))}
      </div>
      <div className="h-64 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
