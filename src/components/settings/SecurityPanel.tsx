'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ApiError, apiRequest } from '@/lib/api-client';

export function SecurityPanel({
  emailVerified,
  email,
}: {
  emailVerified: boolean;
  email: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'verify' | 'signout' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resendVerification() {
    setBusy('verify');
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/api/auth/verify-email', { method: 'PUT' });
      setNotice(`Confirmation sent to ${email}. Check spam if it doesn't appear.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send that email.');
    } finally {
      setBusy(null);
    }
  }

  async function signOutEverywhere() {
    setBusy('signout');
    setError(null);
    try {
      await apiRequest('/api/auth/sign-out-everywhere', { method: 'POST' });
      // This session was invalidated too, so the server components have to
      // re-render against no session rather than leaving a dead page on screen.
      router.replace('/login');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign out.');
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Security"
        description={emailVerified ? 'Email confirmed' : 'Email not confirmed yet'}
      />

      <div className="space-y-3 px-4 py-4 text-sm">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        {!emailVerified ? (
          <Alert tone="warning" title="Confirm your email">
            Until you do, a forgotten password cannot be reset — and that is the one moment you
            will really need it.
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {!emailVerified ? (
            <Button variant="secondary" loading={busy === 'verify'} onClick={() => void resendVerification()}>
              Send the confirmation again
            </Button>
          ) : null}

          <Button variant="secondary" loading={busy === 'signout'} onClick={() => void signOutEverywhere()}>
            Sign out on all devices
          </Button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Signing out everywhere ends every session, including this one. Useful after using a
          shared computer or losing a phone.
        </p>
      </div>
    </Card>
  );
}
