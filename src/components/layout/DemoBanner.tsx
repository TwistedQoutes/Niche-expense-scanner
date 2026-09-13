import Link from 'next/link';

/**
 * The strip that says none of this is real.
 *
 * Permanently visible rather than a dismissible toast, because the whole page
 * beneath it is fabricated and somebody arriving mid-scroll should be able to
 * tell. It also says the two things a prospect will otherwise find out the hard
 * way: nothing is sent, and this disappears.
 */
export function DemoBanner() {
  return (
    <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <strong className="font-semibold">Demo workspace.</strong> The customers, jobs and figures
      here are made up, no texts or emails are actually sent, and this is deleted within a day.{' '}
      <Link href="/signup" className="font-medium underline underline-offset-2">
        Start a real one
      </Link>
      .
    </div>
  );
}
