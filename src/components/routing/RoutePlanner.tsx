'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * The button that rewrites a day.
 *
 * Deliberately not a one-tap action. What is being changed is a set of times
 * customers have been told, so the step between seeing the plan and living with
 * it is a confirmation that says, in words, the two things somebody would
 * otherwise find out afterwards: the times move, and nobody is told.
 *
 * The product can text customers — it has an automation engine for exactly that
 * — and it would be a single call from here. It is not made, because a dozen
 * people receiving an unexplained new appointment time because their gardener
 * pressed a button on a map is a worse outcome than a dozen phone calls the
 * gardener chose to make.
 */
export function RoutePlanner({
  date,
  order,
  stopCount,
  savedLabel,
}: {
  date: string;
  /** Appointment ids, in the order to apply. */
  order: string[];
  stopCount: number;
  savedLabel: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const result = await apiRequest<{ moved: number }>('/api/route-plan', {
        method: 'POST',
        body: { date, order },
      });

      toast.success(
        result.moved === 0
          ? 'Nothing needed moving.'
          : `${result.moved} ${result.moved === 1 ? 'job' : 'jobs'} moved.`,
      );
      setConfirming(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That did not work.');
      toast.error('The day is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button onClick={() => setConfirming(true)}>Use this order</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        This re-times {stopCount} {stopCount === 1 ? 'job' : 'jobs'} on {date}, keeping each
        one&rsquo;s length and starting when the day already starts. {savedLabel}
      </p>
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
        Your customers are not told. Anyone who was given a time needs to hear from you.
      </p>

      <div className="flex gap-2">
        <Button size="sm" loading={busy} onClick={() => void apply()}>
          Move the jobs
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Leave it as it is
        </Button>
      </div>
    </div>
  );
}
