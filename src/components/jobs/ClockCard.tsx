'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { Card, CardHeader } from '@/components/ui/Card';
import { ShareLocation } from '@/components/jobs/ShareLocation';
import { ApiError, apiRequest } from '@/lib/api-client';
import type { LOCATION_NOTES } from '@/lib/validation/time';

/**
 * The button a crew member taps in somebody's front garden.
 *
 * Everything about this component is shaped by where it is used: outdoors, on a
 * phone, in the sun, one-handed, on a connection that comes and goes. So it is
 * one large button that does one thing, and the rule it follows above all others
 * is that **the tap always works**.
 *
 * Location is asked for, waited on briefly, and then given up on. It is never a
 * precondition. A crew member who declines the permission, or whose phone cannot
 * see the sky behind a house, still clocks in — the entry simply records why
 * there is no pin. Any other design produces the same outcome in the end: a crew
 * that cannot start work, and an owner who goes back to a paper timesheet.
 */

type Fix =
  | { kind: 'pin'; latitude: number; longitude: number; accuracyMetres: number }
  | { kind: 'none'; note: (typeof LOCATION_NOTES)[number] };

/**
 * How long to wait for the phone before starting anyway.
 *
 * A cold GPS fix can take thirty seconds. Nobody stands in a garden holding a
 * phone for thirty seconds, so after eight the clock starts without a pin —
 * which is a better record than a tap that never happened because the crew
 * member gave up and put the phone away.
 */
const FIX_TIMEOUT_MS = 8_000;

/**
 * The same wait again, enforced by us rather than by the browser.
 *
 * `getCurrentPosition` takes a `timeout`, and it is not enough. That timeout
 * only starts once permission has been decided, so while a permission prompt is
 * sitting on screen unanswered *neither* callback ever fires — and the tap hangs
 * on "Finding you…" for as long as the prompt goes unanswered, which on a phone
 * that has been put back in a pocket is forever.
 *
 * That is not a hypothetical. It is how this behaved the first time it was run
 * against a browser that had not been asked about location yet, and it breaks
 * the one promise this component makes. So the clock starts on our own clock,
 * whatever the browser is or is not doing.
 */
function withDeadline(promise: Promise<Fix>, fallback: Fix): Promise<Fix> {
  return new Promise<Fix>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), FIX_TIMEOUT_MS);

    void promise.then((fix) => {
      clearTimeout(timer);
      resolve(fix);
    });
  });
}

async function currentFix(): Promise<Fix> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return { kind: 'none', note: 'unsupported' };
  }

  /*
   * Browsers refuse geolocation outside a secure context, and they do it by
   * failing the request rather than by saying why. Distinguished here so a
   * deployment served over plain HTTP does not look like a crew member declining
   * — one is a config problem, the other is a person.
   */
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return { kind: 'none', note: 'insecure' };
  }

  const asked = new Promise<Fix>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          kind: 'pin',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMetres: position.coords.accuracy,
        }),
      (error) =>
        resolve({
          kind: 'none',
          note:
            error.code === error.PERMISSION_DENIED
              ? 'denied'
              : error.code === error.TIMEOUT
                ? 'timeout'
                : 'unavailable',
        }),
      {
        enableHighAccuracy: true,
        timeout: FIX_TIMEOUT_MS,
        /*
         * A fix from the last minute is fine and saves the wait. Anything older
         * could be the last job's driveway, which would be worse than no pin at
         * all: a wrong pin looks like evidence.
         */
        maximumAge: 60_000,
      },
    );
  });

  /*
   * Reported as a timeout, because from the crew member's side that is what it
   * was: they tapped, the phone did not answer in time, and the clock started
   * anyway. Whether the phone was thinking or waiting on a prompt nobody read is
   * a distinction the timesheet does not need.
   */
  return withDeadline(asked, { kind: 'none', note: 'timeout' });
}

function fixToBody(fix: Fix): Record<string, unknown> {
  return fix.kind === 'pin'
    ? {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyMetres: fix.accuracyMetres,
      }
    : { locationNote: fix.note };
}

const NO_PIN_REASON: Record<(typeof LOCATION_NOTES)[number], string> = {
  denied: 'Clocked in without a location — this phone has location turned off for this site.',
  unavailable: 'Clocked in without a location — the phone could not get a fix.',
  timeout: 'Clocked in without a location — the phone was still looking.',
  unsupported: 'Clocked in without a location — this browser cannot do it.',
  insecure: 'Clocked in without a location — this site is not being served securely.',
};

export function ClockCard({
  jobId,
  onTheClockSince,
  crewOnSite,
}: {
  jobId: string;
  /** When the viewer's own open entry started, or null if they are off. */
  onTheClockSince: string | null;
  /** How many people are on the clock here, including the viewer. */
  crewOnSite: number;
}) {
  const router = useRouter();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);

  const on = onTheClockSince !== null;

  async function punch(action: 'in' | 'out') {
    if (busy) return;

    setBusy(true);
    setError(null);
    setLocating(true);

    // Asked for before the request and never blocking it.
    const fix = await currentFix();
    setLocating(false);

    try {
      const result = await apiRequest<{ changed: boolean; minutes?: number | null }>(
        `/api/jobs/${jobId}/time`,
        {
          method: 'POST',
          body: {
            action,
            ...fixToBody(fix),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        },
      );

      if (result.changed === false) {
        toast.success(action === 'in' ? 'You were already on.' : 'You were already off.');
      } else if (action === 'in') {
        toast.success(fix.kind === 'pin' ? 'Clocked in.' : NO_PIN_REASON[fix.note]);
      } else {
        const minutes = result.minutes ?? 0;
        const hours = Math.floor(minutes / 60);
        toast.success(
          `Clocked out — ${hours > 0 ? `${hours}h ` : ''}${minutes % 60}m on this job.`,
        );
      }

      setNote('');
      setNoteOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That did not work.');
      toast.error('Nothing changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={on ? 'You are on the clock' : 'Your time'}
        description={
          on
            ? `Since ${new Date(onTheClockSince).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${
                crewOnSite > 1 ? ` · ${crewOnSite} on site` : ''
              }`
            : 'Tap when you arrive. Tap again when you leave.'
        }
      />

      <div className="space-y-3 p-4 pt-0">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Button
          size="lg"
          className="w-full"
          variant={on ? 'secondary' : 'primary'}
          loading={busy}
          onClick={() => void punch(on ? 'out' : 'in')}
        >
          {locating ? 'Finding you…' : on ? 'Clock out' : 'Clock in'}
        </Button>

        {noteOpen ? (
          <TextAreaField
            label="What happened"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Optional. Goes on this entry — a locked gate, a broken sprinkler."
          />
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="text-xs text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
          >
            Add a note
          </button>
        )}

        {/*
          * Only while the clock is running, and it says so on this screen the
          * whole time. Off the clock the product does not know where anybody is
          * — the endpoint refuses a position from somebody who is not clocked
          * in, and clocking out deletes the last one.
          */}
        {on ? (
          <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
            <ShareLocation />
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Your location is recorded when you tap, and only then. Nothing tracks you
            between taps. If your phone will not share it, you can still clock in.
          </p>
        )}
      </div>
    </Card>
  );
}
