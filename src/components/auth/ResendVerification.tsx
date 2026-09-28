'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * "Send me a new confirmation link."
 *
 * Always to the address on the signed-in account — the request carries no
 * address at all. Signed out, the server answers 401, and this says to sign in
 * rather than showing a bare error: the likeliest reason someone is signed out
 * here is that they opened an expired link on a different device.
 */
export function ResendVerification({ email }: { email?: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'already' | 'signedOut'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setState('sending');
    setError(null);
    try {
      const result = await apiRequest<{ sent: boolean; alreadyVerified: boolean }>(
        '/api/auth/verify-email/resend',
        { method: 'POST' },
      );
      setState(result.alreadyVerified ? 'already' : 'sent');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setState('signedOut');
        return;
      }
      setState('idle');
      setError(caught instanceof ApiError ? caught.message : 'Could not send a new link.');
    }
  }

  if (state === 'sent') {
    return (
      <p role="status" className="text-sm text-brand-700 dark:text-brand-400">
        Sent{email ? ` to ${email}` : ''}. The new link replaces any earlier one and is good for three days.
      </p>
    );
  }

  if (state === 'already') {
    return (
      <p role="status" className="text-sm text-brand-700 dark:text-brand-400">
        Your email is already confirmed.
      </p>
    );
  }

  if (state === 'signedOut') {
    return (
      <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
        <Link href="/login?next=/settings" className="font-medium text-brand-700 hover:underline dark:text-brand-400">
          Sign in
        </Link>
        , then send a new link from Settings.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" onClick={resend} loading={state === 'sending'}>
        Send a new confirmation link
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
