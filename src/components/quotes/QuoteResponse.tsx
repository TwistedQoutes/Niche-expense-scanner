'use client';

import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';

type Action = 'accept' | 'decline' | 'changes';

/**
 * The three buttons at the bottom of a customer's quote.
 *
 * Accept is deliberately the only primary button, and the other two are quiet.
 * This is not a neutral form — it is the page the whole product funnels towards —
 * but declining still has to be easy to find, because a customer who cannot say
 * no just says nothing, and an ignored quote tells the business less than a
 * declined one.
 */
export function QuoteResponse({
  publicId,
  businessName,
  initialStatus,
}: {
  publicId: string;
  businessName: string;
  initialStatus: 'open' | 'accepted' | 'declined' | 'changes' | 'expired';
}) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNote, setShowNote] = useState<null | 'decline' | 'changes'>(null);
  const [note, setNote] = useState('');

  // Fired once on mount so the business knows the quote was opened. Kept out of
  // the server render, where a prefetch or a double-render would count as a
  // human reading it.
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;

    void apiRequest(`/api/public/quotes/${publicId}/view`, { method: 'POST' }).catch(() => {
      // A failed view ping must never interrupt the customer. The quote still
      // reads and still accepts; the owner simply misses one data point.
    });
  }, [publicId]);

  async function respond(action: Action) {
    if (pending) return;

    setPending(action);
    setError(null);

    try {
      const result = await apiRequest<{ status: string }>(
        `/api/public/quotes/${publicId}/respond`,
        { method: 'POST', body: { action, note: note.trim() || undefined } },
      );

      setStatus(
        result.status === 'ACCEPTED'
          ? 'accepted'
          : result.status === 'DECLINED'
            ? 'declined'
            : 'changes',
      );
      setShowNote(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Something went wrong. Please try again, or call us.',
      );
    } finally {
      setPending(null);
    }
  }

  if (status === 'accepted') {
    return (
      <Alert tone="success" title="Accepted — thank you">
        <p>
          {businessName} has been notified and will be in touch to confirm a time. There is nothing
          else you need to do.
        </p>
      </Alert>
    );
  }

  if (status === 'declined') {
    return (
      <Alert tone="info" title="Thanks for letting us know">
        <p>We have passed that on to {businessName}. If you change your mind, just get in touch.</p>
      </Alert>
    );
  }

  if (status === 'changes') {
    return (
      <Alert tone="info" title="We have asked them to take another look">
        <p>{businessName} will review your notes and send an updated quote.</p>
      </Alert>
    );
  }

  if (status === 'expired') {
    return (
      <Alert tone="warning" title="This quote has expired">
        <p>
          Prices move, so this one is no longer valid. Get in touch with {businessName} and they
          will send you an up-to-date price.
        </p>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {showNote ? (
        <div className="space-y-3">
          <TextAreaField
            label={
              showNote === 'changes' ? 'What would you like changed?' : 'Anything you want to add?'
            }
            rows={4}
            placeholder={
              showNote === 'changes'
                ? 'Could you also do the back garden?'
                : 'Optional — it helps them improve.'
            }
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              variant={showNote === 'changes' ? 'primary' : 'danger'}
              loading={pending !== null}
              onClick={() => void respond(showNote)}
            >
              {showNote === 'changes' ? 'Send my changes' : 'Confirm decline'}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              disabled={pending !== null}
              onClick={() => {
                setShowNote(null);
                setNote('');
              }}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Button
            size="lg"
            fullWidth
            loading={pending === 'accept'}
            disabled={pending !== null}
            onClick={() => void respond('accept')}
          >
            Accept quote
          </Button>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              size="lg"
              variant="secondary"
              fullWidth
              disabled={pending !== null}
              onClick={() => setShowNote('changes')}
            >
              Request changes
            </Button>
            <Button
              size="lg"
              variant="ghost"
              fullWidth
              disabled={pending !== null}
              onClick={() => setShowNote('decline')}
            >
              Decline
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
