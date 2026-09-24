import { Skeleton } from '@/components/ui/Skeleton';

/**
 * The shapes a loading screen comes in.
 *
 * Every screen in this app is one of four layouts — a list, a record, a board,
 * or a page of settings — so the loading states are four components rather than
 * twenty-three hand-built files that would drift apart the first time a page
 * changed.
 *
 * Why bother at all: without a `loading.tsx`, Next holds the old screen in place
 * while the server works and then swaps the whole thing at once. The app is not
 * slow, but it *feels* slow, because nothing acknowledges the tap — and the
 * gap between tapping and seeing is where software feels cheap. A shape that
 * appears instantly and is replaced by content of the same size reads as fast
 * even when the wait is identical.
 *
 * **A page built of form fields gets no loading file either**, and this one cost
 * a test to find. A Suspense boundary means the form arrives as a streamed chunk
 * that React inserts into the page; somebody who taps a field and starts typing
 * inside that window is typing into markup that is about to be replaced, and
 * their first characters go with it. The address-autocomplete spec caught it as
 * "12 Oak Lane" arriving at the server as "Oak Lane" — which on a real phone is
 * a customer's house number quietly missing from a lead.
 *
 * The trade is not close: a form renders fast because there is nothing to fetch,
 * so the skeleton was buying almost nothing and charging keystrokes for it.
 *
 * **Not every route can have one.** A `loading.tsx` creates a Suspense boundary,
 * which makes Next stream the response — and once streaming has begun the HTTP
 * status is already sent, so a `notFound()` thrown afterwards renders the
 * not-found body under a **200**. On a page whose first act is an authorization
 * check that answers a prober with a 404, that quietly downgrades the very
 * property the 404 was chosen for.
 *
 * So `/admin`, `/profit` and `/route` have no loading file. They gate on role
 * and rely on the status code to keep an unauthorised visitor from learning the
 * surface exists. The E2E suite asserts that 404 directly, which is how this was
 * caught rather than shipped.
 *
 * Between the two rules: a loading state belongs on a page that *waits on a
 * query and then shows you rows*. It does not belong on a page that gates on who
 * you are, or that exists for you to type into.
 *
 * Shapes, not spinners, and deliberately so. A spinner says "something is
 * happening somewhere"; a block the size of the row that is coming says "your
 * list is on its way, and it will be here". It also keeps the layout still,
 * which is the part people notice without being able to name.
 */

/** The heading block every page starts with. */
function Title({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className={wide ? 'h-8 w-64' : 'h-8 w-44'} />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
      {children}
    </div>
  );
}

/*
 * Row widths, written out as literal classes.
 *
 * Not computed. Tailwind finds classes by scanning the source for complete
 * strings, so `w-[${60 - index * 4}%]` produces no CSS at all and every row
 * silently renders full width — a bug that typechecks, lints, and looks like a
 * design decision.
 *
 * The widths vary because identical bars read as a loading *graphic*, where
 * uneven ones read as text that has not arrived yet, which is what they are.
 */
const ROW_WIDTHS = ['w-3/5', 'w-1/2', 'w-7/12', 'w-5/12', 'w-2/3', 'w-1/2', 'w-5/12', 'w-3/5'];

function Rows({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={`h-4 ${ROW_WIDTHS[index % ROW_WIDTHS.length]}`} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Jobs, quotes, customers, reviews — anything that is a list of records. */
export function ListSkeleton({ rows = 6, stats = 0 }: { rows?: number; stats?: number }) {
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <Title />

      {stats > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : null}

      <CardShell>
        <Rows rows={rows} />
      </CardShell>
    </div>
  );
}

/** One record with a sidebar: a job, a quote, a customer, a lead. */
export function RecordSkeleton() {
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <Title wide />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <CardShell>
            <Rows rows={3} />
          </CardShell>
          <CardShell>
            <Rows rows={4} />
          </CardShell>
        </div>

        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-36 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

/** The pipeline board, and the calendar, which are both columns of cards. */
export function BoardSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <Title />

      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: columns }, (_, index) => (
          <div key={index} className="w-64 shrink-0 space-y-2">
            <Skeleton className="h-5 w-28" />
            {Array.from({ length: 3 - (index % 2) }, (_, card) => (
              <Skeleton key={card} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Settings, pricing, team, billing — a column of forms. */
export function FormSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-6">
      <Title />

      {Array.from({ length: sections }, (_, index) => (
        <CardShell key={index}>
          <div className="space-y-4 p-4">
            <Skeleton className="h-5 w-40" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
          </div>
        </CardShell>
      ))}
    </div>
  );
}
