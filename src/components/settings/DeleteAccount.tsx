'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * Deleting your own account. Shown to everyone, including crew.
 *
 * Separate from `DataControls`, which deletes a whole workspace and is an
 * owner's decision about a business. This one is a person leaving, and it has
 * to be reachable by someone who owns nothing — before it existed they had to
 * email and ask, which App Store Review Guideline 5.1.1(v) treats as not having
 * the feature at all.
 *
 * Folded behind a button for the same reason as the workspace version: nobody
 * should meet a red form while looking for something else.
 */
export function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const confirmed = confirm.trim().toUpperCase() === 'DELETE';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || busy) return;

    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiRequest('/api/account/delete', {
        method: 'POST',
        body: { password, confirm: 'DELETE' },
      });
      // Replace rather than push: Back must not return to a settings page for
      // an account that no longer exists.
      router.replace('/goodbye');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFieldErrors(cause.fieldErrors ?? {});
        setError(cause.fieldErrors ? null : cause.message);
      } else {
        setError('Something went wrong. Try again.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
      <h3 className="font-medium text-slate-900 dark:text-slate-100">Delete my account</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Removes {email} and signs you out everywhere. The work you have done — jobs, quotes,
        logged hours — stays with the business, because those are its records.
      </p>

      {!open ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => setOpen(true)}
        >
          Delete my account…
        </Button>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Alert tone="warning">
            This cannot be undone. If you are the only owner of a workspace, hand it over or
            delete it first.
          </Alert>

          {error ? <Alert tone="error">{error}</Alert> : null}

          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            required
          />

          <TextField
            label="Type DELETE to confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            error={fieldErrors.confirm}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            required
          />

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" loading={busy} disabled={!confirmed}>
              Delete my account permanently
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setConfirm('');
                setPassword('');
                setError(null);
                setFieldErrors({});
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
