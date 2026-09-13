'use client';

import { JobStatus } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { centsToDecimalString, parseAmountToCents } from '@/lib/money';

/**
 * Starting, finishing and calling off a job.
 *
 * Completion is the one that cannot be undone — it moves the customer's lifetime
 * value and sets the review request going — so it asks for confirmation and shows
 * what is about to be recorded, rather than being a single tap that quietly does
 * all of that.
 */
export function JobActions({
  jobId,
  status,
  priceCents,
  customerName,
}: {
  jobId: string;
  status: JobStatus;
  priceCents: number;
  customerName: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'complete' | 'cancel'>('none');

  // A plain decimal, not a formatted currency: the field is edited, and a 
  // leading symbol is something the user has to delete before typing.
  const [finalPrice, setFinalPrice] = useState(centsToDecimalString(priceCents));
  const [completionNotes, setCompletionNotes] = useState('');
  const [nextServiceDays, setNextServiceDays] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  async function act(body: Record<string, unknown>, success: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const result = await apiRequest<{ changed?: boolean }>(`/api/jobs/${jobId}/status`, {
        method: 'POST',
        body,
      });

      // The API tells us when a repeat call changed nothing, so a double tap does
      // not claim the job was just completed for a second time.
      toast.success(result.changed === false ? 'That was already done.' : success);
      setPanel('none');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That did not work.');
      toast.error('Nothing changed.');
    } finally {
      setBusy(false);
    }
  }

  function complete() {
    const cents = parseAmountToCents(finalPrice);

    if (cents === null) {
      setError('That final price is not a number.');
      return;
    }

    void act(
      {
        action: 'complete',
        finalPriceCents: cents,
        ...(completionNotes.trim() ? { completionNotes: completionNotes.trim() } : {}),
        ...(nextServiceDays.trim() ? { nextServiceDays: Number(nextServiceDays) } : {}),
      },
      'Job marked done.',
    );
  }

  if (status === JobStatus.COMPLETED || status === JobStatus.CANCELLED) {
    return null;
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {panel === 'none' ? (
        <div className="flex flex-wrap gap-2">
          {status === JobStatus.SCHEDULED || status === JobStatus.CONFIRMED ? (
            <Button size="sm" loading={busy} onClick={() => void act({ action: 'start' }, 'On site.')}>
              Start work
            </Button>
          ) : null}

          {status === JobStatus.CONFIRMED || status === JobStatus.IN_PROGRESS ? (
            <Button size="sm" variant="secondary" onClick={() => setPanel('complete')}>
              Mark it done
            </Button>
          ) : null}

          <Button size="sm" variant="ghost" onClick={() => setPanel('cancel')}>
            Cancel job
          </Button>
        </div>
      ) : null}

      {panel === 'complete' ? (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            This adds to {customerName}&rsquo;s lifetime value and starts the review request. It
            cannot be undone.
          </p>

          <TextField
            label="What it came to"
            value={finalPrice}
            onChange={(event) => setFinalPrice(event.target.value)}
            hint="Change it if the job was bigger or smaller than quoted."
          />

          <TextAreaField
            label="Notes for the record"
            rows={2}
            value={completionNotes}
            onChange={(event) => setCompletionNotes(event.target.value)}
          />

          <TextField
            label="Due again in (days)"
            type="number"
            min={1}
            value={nextServiceDays}
            onChange={(event) => setNextServiceDays(event.target.value)}
            hint="Optional. Sets the reminder that brings them back."
          />

          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={complete}>
              Confirm it is done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel('none')}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {panel === 'cancel' ? (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            The slot goes back on the calendar and any follow-up about this job stops.
          </p>

          <TextField
            label="Why (optional)"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
          />

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              loading={busy}
              onClick={() =>
                void act(
                  {
                    action: 'cancel',
                    ...(cancelReason.trim() ? { reason: cancelReason.trim() } : {}),
                  },
                  'Job cancelled.',
                )
              }
            >
              Cancel the job
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel('none')}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
