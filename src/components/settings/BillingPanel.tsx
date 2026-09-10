'use client';

import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ApiError, apiRequest } from '@/lib/api-client';
import type { AccessState } from '@/lib/billing/access';

const STATUS_COPY: Record<AccessState['status'], { title: string; body: string }> = {
  billing_disabled: {
    title: 'Free',
    body: 'This installation has no billing configured — everything is available.',
  },
  trialing: { title: 'Free trial', body: 'Full access while you try it out.' },
  subscribed: { title: 'Subscribed', body: 'Thank you — everything is unlocked.' },
  trial_expired: {
    title: 'Trial ended',
    body: 'You can still view, edit and export everything. Subscribe to log new expenses.',
  },
  past_due: {
    title: 'Payment failed',
    body: 'Your card was declined. Update it and nothing will be interrupted.',
  },
  canceled: {
    title: 'Subscription ended',
    body: 'Your records stay available to view and export. Resubscribe to log new expenses.',
  },
};

export function BillingPanel({
  access,
  priceLabel,
  hasBillingAccount,
}: {
  access: AccessState;
  priceLabel: string;
  hasBillingAccount: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(endpoint: 'checkout' | 'portal') {
    setBusy(true);
    setError(null);

    try {
      const { url } = await apiRequest<{ url: string }>(`/api/billing/${endpoint}`, {
        method: 'POST',
      });
      // A full navigation, not a fetch: Stripe's pages are their own origin.
      window.location.assign(url);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not open billing.');
      setBusy(false);
    }
  }

  if (access.status === 'billing_disabled') return null;

  const copy = STATUS_COPY[access.status];
  const subscribed = access.status === 'subscribed' || access.status === 'past_due';

  return (
    <Card>
      <CardHeader title="Subscription" description={copy.title} />

      <div className="space-y-3 px-4 py-4 text-sm">
        <p className="text-zinc-600 dark:text-zinc-400">{copy.body}</p>

        {access.status === 'trialing' && access.trialDaysLeft !== null ? (
          <p className="font-medium">
            {access.trialDaysLeft} {access.trialDaysLeft === 1 ? 'day' : 'days'} left
          </p>
        ) : null}

        {subscribed && access.currentPeriodEnd ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            {access.status === 'past_due' ? 'Retrying until ' : 'Renews '}
            {new Date(access.currentPeriodEnd).toLocaleDateString()}
          </p>
        ) : null}

        {!access.canWrite ? (
          <Alert tone="warning">
            Nothing has been deleted. Everything you have logged is still here to view and export.
          </Alert>
        ) : null}

        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="flex flex-wrap gap-2 pt-1">
          {subscribed || hasBillingAccount ? (
            <Button variant="secondary" loading={busy} onClick={() => void go('portal')}>
              Manage billing
            </Button>
          ) : null}

          {!subscribed ? (
            <Button loading={busy} onClick={() => void go('checkout')}>
              Subscribe — {priceLabel}
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Cancel any time from the billing portal. No email required.
        </p>
      </div>
    </Card>
  );
}
