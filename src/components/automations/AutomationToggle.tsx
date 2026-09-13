'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * Switching one automation on or off.
 *
 * The confirmation copy is specific about what turning it on means, because the
 * consequence is that the product starts texting this owner's customers without
 * asking again each time. "Enabled" is a small word for that.
 */
export function AutomationToggle({
  automationId,
  enabled,
  canEdit,
  blockedReason,
}: {
  automationId: string;
  enabled: boolean;
  canEdit: boolean;
  /** Set when the channel this automation needs is not configured. */
  blockedReason: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {enabled ? 'On' : 'Off'}
      </span>
    );
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);

    try {
      await apiRequest(`/api/automations/${automationId}`, {
        method: 'PATCH',
        body: { enabled: !enabled },
      });

      toast.success(enabled ? 'Automation turned off.' : 'Automation turned on.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={enabled ? 'secondary' : 'primary'}
        loading={busy}
        onClick={() => void toggle()}
      >
        {enabled ? 'Turn off' : 'Turn on'}
      </Button>

      {blockedReason && !enabled ? (
        <span className="max-w-48 text-right text-xs text-amber-700 dark:text-amber-500">
          {blockedReason}
        </span>
      ) : null}
    </div>
  );
}
