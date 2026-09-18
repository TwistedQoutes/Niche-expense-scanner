'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * Sending a quote, and copying its link.
 *
 * Email and SMS delivery arrive with the messaging phase. Until then this is
 * deliberately honest about what it does — it opens the quote for a response and
 * hands over the link — rather than showing a Send button that quietly does
 * nothing. A link the owner texts themselves is a working quote today.
 */
export function SendQuote({
  quoteId,
  isDraft,
  publicUrl,
}: {
  quoteId: string;
  isDraft: boolean;
  publicUrl: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function send() {
    if (sending) return;
    setSending(true);

    try {
      await apiRequest(`/api/quotes/${quoteId}/send`, { method: 'POST' });
      toast.success('Quote opened for a response. Send the link to your customer.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not send that quote.');
    } finally {
      setSending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in some browsers and over plain HTTP. The
      // link is selectable on the page regardless, so this is not a dead end.
      toast.error('Could not copy. Select the link and copy it by hand.');
    }
  }

  return (
    <div className="space-y-3">
      {isDraft ? (
        <>
          <Alert tone="info">
            This is still a draft. Nobody can open it until you send it.
          </Alert>
          <Button fullWidth loading={sending} onClick={() => void send()}>
            Send quote
          </Button>
        </>
      ) : (
        <>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Customer link
            </span>
            <input
              readOnly
              value={publicUrl}
              // Selecting the whole thing on focus makes a manual copy one
              // gesture rather than a careful drag.
              onFocus={(event) => event.currentTarget.select()}
              className="w-full rounded-xl bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="ghost">
                Preview as customer
              </Button>
            </a>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Anyone with this link can see and accept the quote, so treat it like a password.
          </p>
        </>
      )}
    </div>
  );
}
