'use client';

import { PlanTier } from '@prisma/client';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * Choosing a plan, and managing an existing one.
 *
 * Both buttons hand off to a Stripe-hosted page. No card details are typed into
 * this product, which is a deliberate scope decision rather than a shortcut —
 * handling them would put the whole application in PCI scope.
 */
export function PlanActions({
  tier,
  currentTier,
  hasBillingAccount,
  canManage,
  billingConfigured,
}: {
  tier: PlanTier;
  currentTier: PlanTier;
  hasBillingAccount: boolean;
  canManage: boolean;
  billingConfigured: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const isCurrent = tier === currentTier;

  async function go(path: string, body?: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);

    try {
      const { url } = await apiRequest<{ url: string }>(path, { method: 'POST', body });

      // A full navigation, not a router push: the destination is Stripe's.
      window.location.href = url;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not open checkout.');
      setBusy(false);
    }
  }

  if (!canManage) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {isCurrent ? 'Your current plan.' : 'Only the owner can change the plan.'}
      </p>
    );
  }

  if (!billingConfigured) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {isCurrent ? 'Your current plan.' : 'Billing is not configured on this deployment.'}
      </p>
    );
  }

  if (isCurrent) {
    return hasBillingAccount ? (
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={() => void go('/api/billing/portal')}
      >
        Manage billing
      </Button>
    ) : (
      <p className="text-xs text-slate-500 dark:text-slate-400">Your current plan.</p>
    );
  }

  if (tier === PlanTier.FREE) {
    // Downgrading to free is a cancellation, and cancellation lives in Stripe's
    // portal where the customer can see exactly what it means and when.
    return hasBillingAccount ? (
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        onClick={() => void go('/api/billing/portal')}
      >
        Cancel in portal
      </Button>
    ) : null;
  }

  return (
    <Button size="sm" loading={busy} onClick={() => void go('/api/billing/checkout', { tier })}>
      Choose {tier === PlanTier.STARTER ? 'Starter' : tier === PlanTier.PRO ? 'Pro' : 'Business'}
    </Button>
  );
}
