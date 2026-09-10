'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { formatMonthLabel } from '@/lib/dates';

/**
 * CSV download.
 *
 * The file is fetched rather than linked so an expired session surfaces as a
 * readable message instead of the browser silently saving an HTML error page
 * named `expenses-2026-09.csv` — which is exactly the sort of thing that gets
 * discovered at 11pm on tax deadline day.
 */
export function ExportButton({ month, disabled }: { month: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(scope: 'month' | 'all') {
    setBusy(true);
    setError(null);

    try {
      const query = scope === 'month' ? `?month=${encodeURIComponent(month)}` : '';
      const response = await fetch(`/api/expenses/export${query}`, { credentials: 'same-origin' });

      if (!response.ok) {
        setError(
          response.status === 401
            ? 'Your session expired. Sign in again to export.'
            : 'The export failed. Please try again.',
        );
        return;
      }

      const blob = await response.blob();
      const filename =
        /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ??
        `expenses-${scope === 'month' ? month : 'all-time'}.csv`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Revoke on the next tick; revoking synchronously can cancel the download.
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setError('The export failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          disabled={disabled}
          onClick={() => void download('month')}
        >
          Export {formatMonthLabel(month).split(' ')[0]}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy || disabled} onClick={() => void download('all')}>
          Export all
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
