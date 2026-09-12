'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * "Look around first."
 *
 * Provisioning a whole seeded workspace takes a second or two, so the button says
 * what it is doing rather than appearing to hang — this is a visitor's first
 * impression of whether the product is quick.
 */
export function DemoButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await apiRequest('/api/demo', { method: 'POST' });
      router.push('/dashboard');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start the demo just now.');
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Button
        size="lg"
        variant="secondary"
        className="w-full sm:w-auto"
        loading={busy}
        onClick={() => void start()}
      >
        {busy ? 'Setting up your demo…' : 'Try the demo'}
      </Button>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
