'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * Asking one customer for a review.
 *
 * The button disables itself after a successful ask rather than relying on the
 * refresh, because the request is a real text message and a second tap while the
 * page re-renders would be a second one.
 */
export function AskForReview({
  customerId,
  jobId,
  label = 'Ask for a review',
}: {
  customerId: string;
  jobId?: string;
  label?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function ask() {
    if (busy || done) return;

    setBusy(true);
    try {
      await apiRequest('/api/reviews', {
        method: 'POST',
        body: { customerId, ...(jobId ? { jobId } : {}) },
      });

      setDone(true);
      toast.success('Review request queued.');
      router.refresh();
    } catch (caught) {
      // The refusals are all things the owner can fix — no review link set, the
      // customer opted out, already asked — so the message is shown as-is.
      toast.error(caught instanceof ApiError ? caught.message : 'Could not ask for that review.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" loading={busy} disabled={done} onClick={() => void ask()}>
      {done ? 'Asked' : label}
    </Button>
  );
}
