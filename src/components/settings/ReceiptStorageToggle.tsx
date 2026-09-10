'use client';

import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ApiError, apiRequest } from '@/lib/api-client';
import type { UserDto } from '@/types';

/**
 * The retention opt-in.
 *
 * Written to be read before it is used, because it changes what we hold about
 * the artist. It states plainly what turning it on means, why they might want
 * it (tax substantiation), and what turning it off does — which is delete, not
 * just stop.
 */
export function ReceiptStorageToggle({
  initialEnabled,
  available,
  maxImageBytes,
}: {
  initialEnabled: boolean;
  available: boolean;
  maxImageBytes: number;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);

  async function apply(next: boolean) {
    setSaving(true);
    setError(null);

    try {
      const { user } = await apiRequest<{ user: UserDto }>('/api/settings', {
        method: 'PATCH',
        body: { storeReceiptImages: next },
      });
      setEnabled(user.storeReceiptImages);
      setConfirmingOff(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not change that setting.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Keep receipt images"
        description={enabled ? 'On — images are kept with each expense' : 'Off — only the text is kept'}
      />

      <div className="space-y-3 px-4 py-4 text-sm">
        {!available ? (
          <Alert tone="info">
            This installation is not set up to store images, so there is nothing to turn on. A
            deployment enables it by setting <code>RECEIPT_STORAGE_DRIVER</code>.
          </Alert>
        ) : null}

        <p className="text-zinc-600 dark:text-zinc-400">
          Scanning always reads the receipt on your own device. This setting controls whether a
          copy of the photo is also <span className="font-medium">kept</span> alongside the
          expense.
        </p>

        <ul className="space-y-1.5 text-zinc-600 dark:text-zinc-400">
          <li>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">Why you might:</span> the
            IRS expects documentary evidence for expenses over $75, and a photo of the receipt is
            it.
          </li>
          <li>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">Why you might not:</span>{' '}
            a receipt can show a client&rsquo;s name or a card&rsquo;s last four digits, and this
            puts that on our server rather than only your phone.
          </li>
          <li>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">Either way:</span>{' '}
            location data is stripped from the photo before it is uploaded, and images are capped
            at {Math.round(maxImageBytes / (1024 * 1024))} MB.
          </li>
        </ul>

        {error ? <Alert tone="error">{error}</Alert> : null}

        {confirmingOff ? (
          <Alert tone="warning" title="Turn off and delete?">
            <p>
              Switching this off also deletes the receipt images already stored. The expenses
              themselves are untouched. This cannot be undone.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button variant="danger" size="sm" loading={saving} onClick={() => void apply(false)}>
                Turn off and delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingOff(false)}>
                Cancel
              </Button>
            </div>
          </Alert>
        ) : (
          <Button
            variant={enabled ? 'secondary' : 'primary'}
            loading={saving}
            disabled={!available && !enabled}
            onClick={() => (enabled ? setConfirmingOff(true) : void apply(true))}
          >
            {enabled ? 'Turn off image storage' : 'Keep receipt images'}
          </Button>
        )}
      </div>
    </Card>
  );
}
