'use client';

import { Download, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button, buttonClasses } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';
import { namesMatch } from '@/lib/validation/workspace';

/**
 * Download everything, or delete everything. Shown to the owner only.
 *
 * The download is a plain link: the browser saves the zip itself, with a
 * progress bar it already knows how to draw, and nothing here has to hold the
 * file in memory.
 *
 * Deletion is folded away behind its own button so that nobody meets a red form
 * while looking for the download, and the final button stays disabled until the
 * name is typed — the server checks both again, this only saves a round trip.
 */
export function DataControls({ businessName, isDemo }: { businessName: string; isDemo: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const confirmed = namesMatch(confirmName, businessName);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || busy) return;

    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiRequest('/api/workspace/delete', { method: 'POST', body: { confirmName, password } });
      // Replace, not push: Back must not return to settings for a workspace
      // that no longer exists. (It would only bounce to sign-in — the session
      // cookie is already cleared — but it should not be offered.)
      router.replace('/goodbye');
    } catch (caught) {
      setBusy(false);
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fieldErrors);
        if (Object.keys(caught.fieldErrors).length === 0) setError(caught.message);
      } else {
        setError('Something went wrong. Nothing has been deleted.');
      }
    }
  }

  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-800">
      <section className="pb-5">
        <h3 className="font-medium text-slate-900 dark:text-slate-100">Download everything</h3>
        <p className="mt-1 text-sm text-pretty text-slate-600 dark:text-slate-400">
          Customers, leads, quotes, jobs, messages, time sheets and settings, as spreadsheets that open
          in Excel or Google Sheets. Photos are listed with a link to each.
        </p>
        <a
          href="/api/workspace/export"
          download
          className={buttonClasses({ variant: 'secondary', className: 'mt-3' })}
        >
          <Download className="size-4" strokeWidth={2} aria-hidden="true" />
          Download .zip
        </a>
      </section>

      <section className="pt-5">
        <h3 className="font-medium text-slate-900 dark:text-slate-100">Delete this workspace</h3>

        {isDemo ? (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            This is a demo. It deletes itself automatically.
          </p>
        ) : !open ? (
          <>
            <p className="mt-1 text-sm text-pretty text-slate-600 dark:text-slate-400">
              Removes every customer, lead, quote, job, message and photo, cancels your subscription,
              and signs everyone out. It cannot be undone.
            </p>
            <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>
              Delete workspace…
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="mt-3 space-y-4" noValidate>
            <Alert tone="error" title="This is permanent">
              <ul className="list-disc space-y-1 pl-5">
                <li>Everything in {businessName} is deleted, including photos.</li>
                <li>Your subscription is cancelled now, with no further charges.</li>
                <li>
                  Your teammates are signed out, and any account that belongs to no other workspace is
                  deleted — yours included.
                </li>
                <li>We cannot restore it. Download a copy first if you might want it.</li>
              </ul>
            </Alert>

            {error ? <Alert tone="error">{error}</Alert> : null}

            <TextField
              label={`Type “${businessName}” to confirm`}
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              error={fieldErrors.confirmName}
              autoComplete="off"
              spellCheck={false}
            />
            <TextField
              label="Your password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
              autoComplete="current-password"
            />

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setConfirmName('');
                  setPassword('');
                  setError(null);
                  setFieldErrors({});
                }}
                disabled={busy}
              >
                Keep my workspace
              </Button>
              <Button
                type="submit"
                variant="danger"
                loading={busy}
                disabled={!confirmed || password.length === 0}
                className="ring-red-600 dark:ring-red-500"
              >
                <TriangleAlert className="size-4" strokeWidth={2} aria-hidden="true" />
                Delete everything permanently
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
