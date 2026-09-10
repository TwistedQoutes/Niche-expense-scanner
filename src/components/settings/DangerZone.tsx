'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * Data export and account deletion.
 *
 * Deliberately in one card: someone about to delete their account should see
 * "take your data with you" in the same glance, not discover afterwards that it
 * was available.
 */
export function DangerZone() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      await apiRequest('/api/account/delete', { method: 'POST', body: { password, confirm } });
      router.replace('/');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fieldErrors);
        if (Object.keys(caught.fieldErrors).length === 0) setError(caught.message);
      } else {
        setError('Could not delete the account.');
      }
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Your data" description="Take it with you, or remove it entirely" />

      <div className="space-y-4 px-4 py-4 text-sm">
        <div className="space-y-2">
          <p className="text-zinc-600 dark:text-zinc-400">
            A complete copy of your account and every expense, as JSON.
          </p>
          {/* A plain link, not fetch: the browser's own download handling is
              better than anything reimplemented here. */}
          <a href="/api/account/export" download>
            <Button variant="secondary" size="sm">
              Download all my data
            </Button>
          </a>
        </div>

        <hr className="border-zinc-100 dark:border-zinc-800" />

        {confirming ? (
          <div className="space-y-3">
            <Alert tone="error" title="This deletes everything, permanently">
              Every expense, every stored receipt image, and the account itself. Any subscription
              is cancelled. This cannot be undone — export your data first if you might want it.
            </Alert>

            {error ? <Alert tone="error">{error}</Alert> : null}

            <TextField
              label="Your password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
              autoComplete="current-password"
              required
            />

            <TextField
              label="Type DELETE to confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              error={fieldErrors.confirm}
              autoCapitalize="characters"
              placeholder="DELETE"
              required
            />

            <div className="flex gap-2">
              <Button variant="danger" loading={busy} onClick={() => void deleteAccount()}>
                Permanently delete my account
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-zinc-600 dark:text-zinc-400">
              Deleting removes everything and cannot be undone.
            </p>
            <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
              Delete my account
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
