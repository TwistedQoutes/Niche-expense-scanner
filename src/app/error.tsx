'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/Button';

/**
 * Route-level error boundary.
 *
 * Next passes a `digest` instead of the real message in production, so the
 * screen shows a recovery path rather than pretending to explain what broke.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] render error', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 text-center">
      <h1 className="text-xl font-bold tracking-tight">That didn&rsquo;t load</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Something went wrong on our end. Your saved expenses are unaffected.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6">
        <Button size="lg" fullWidth onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
