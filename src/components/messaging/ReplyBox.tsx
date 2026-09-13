'use client';

import { Channel } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { MAX_SMS_LENGTH } from '@/lib/sms';

/**
 * Replying by hand.
 *
 * The character counter is not decoration: a text over the limit is split into
 * segments and billed per segment, so the owner is told before they send rather
 * than on their invoice.
 */
export function ReplyBox({
  conversationId,
  channel,
  optedOut,
}: {
  conversationId: string;
  channel: Channel;
  optedOut: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const isSms = channel === Channel.SMS;
  const tooLong = isSms && body.length > MAX_SMS_LENGTH;

  if (optedOut) {
    return (
      <Alert tone="warning" title="This customer has opted out of texts">
        <p>
          They replied STOP, so we will not text them again. They can reply START to resume, or you
          can reach them another way.
        </p>
      </Alert>
    );
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || body.trim().length === 0 || tooLong) return;

    setSending(true);
    setError(null);

    try {
      await apiRequest(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: { body },
      });

      setBody('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send that message.');
      toast.error('Message not sent.');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-2">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <TextAreaField
        label={isSms ? 'Reply by text' : 'Reply by email'}
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        error={tooLong ? `${body.length} characters — the limit is ${MAX_SMS_LENGTH}.` : undefined}
      />

      <div className="flex items-center justify-between gap-3">
        <Button type="submit" size="sm" loading={sending} disabled={tooLong || body.trim() === ''}>
          Send
        </Button>

        {isSms ? (
          <span
            className={
              tooLong
                ? 'tabular text-xs text-red-600 dark:text-red-400'
                : 'tabular text-xs text-slate-500 dark:text-slate-400'
            }
          >
            {body.length}/{MAX_SMS_LENGTH}
          </span>
        ) : null}
      </div>
    </form>
  );
}
