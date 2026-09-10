'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * Redeems a verification link.
 *
 * Redemption is a POST from the client rather than a GET on page load, because
 * mail clients and security scanners prefetch links — a GET that consumes a
 * single-use token would be spent before the artist ever clicked it.
 */
export function VerifyEmail({ token }: { token: string | undefined }) {
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const [message, setMessage] = useState<string | null>(
    token ? null : 'That link is missing its token.',
  );

  // Strict Mode runs effects twice in development; without this guard the
  // second run would redeem an already-spent token and report failure.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        await apiRequest('/api/auth/verify-email', { method: 'POST', body: { token } });
        setState('done');
      } catch (caught) {
        setMessage(
          caught instanceof ApiError ? caught.message : 'Could not confirm that link.',
        );
        setState('failed');
      }
    })();
  }, [token]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      {state === 'working' ? (
        <p className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <Spinner className="size-4" label="Confirming" />
          Confirming your email…
        </p>
      ) : state === 'done' ? (
        <>
          <Alert tone="success" title="Email confirmed">
            You can now recover your account if you ever forget your password.
          </Alert>
          <Link href="/dashboard" className="mt-6 block">
            <Button size="lg" fullWidth>
              Go to my expenses
            </Button>
          </Link>
        </>
      ) : (
        <>
          <Alert tone="error" title="That link didn't work">
            {message} Links expire after three days — you can send a fresh one from Settings.
          </Alert>
          <Link href="/settings" className="mt-6 block">
            <Button size="lg" variant="secondary" fullWidth>
              Open Settings
            </Button>
          </Link>
        </>
      )}
    </main>
  );
}
