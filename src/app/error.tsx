'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/Button';

/**
 * The last line of defence for a render that threw.
 *
 * `error.digest` is the only identifier the client is given: Next replaces the
 * real message with a digest in production precisely so a stack trace does not
 * reach a customer. Showing the digest lets support match a report to a log
 * line without leaking anything about the failure.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] render failed', error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        Something went wrong
      </h1>
      <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">
        The page could not be loaded. Trying again often clears it — nothing you had saved has been
        lost.
      </p>

      {error.digest ? (
        <p className="tabular text-xs text-slate-400 dark:text-slate-500">
          Reference: {error.digest}
        </p>
      ) : null}

      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
