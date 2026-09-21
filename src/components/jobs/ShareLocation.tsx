'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { apiRequest } from '@/lib/api-client';

/**
 * Sharing where you are, while you are on the clock.
 *
 * Rendered only for somebody who is clocked in, and it says so on their own
 * screen the whole time it is running. That visibility is the point rather than
 * a courtesy: a product that collects an employee's location invisibly and one
 * that shows them a line saying "your boss can see roughly where you are, last
 * sent 3 minutes ago, [Stop]" are different products, and the difference is
 * entirely in whether the person can see it.
 *
 * **What this can and cannot do.** A web page cannot report a position when the
 * phone is locked and the browser is in the background — iOS in particular stops
 * timers almost immediately. So this is not a tracker; it is a heartbeat that
 * fires while the app is open, and the screen it feeds says "last seen 14
 * minutes ago" rather than drawing a moving dot. Pretending otherwise would have
 * an owner making promises to a customer based on where somebody was at lunch.
 */

/** How often to send, while the page is open and the clock is running. */
const EVERY_MS = 2 * 60_000;

/** Long enough not to throw a permission prompt over a screen being read. */
const FIRST_SEND_DELAY_MS = 1_000;

/** A fix, or null for every way of not getting one. */
async function currentPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return null;

  return new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  });
}

type State =
  | { kind: 'starting' }
  | { kind: 'sharing'; at: Date }
  | { kind: 'refused' }
  | { kind: 'off' };

export function ShareLocation() {
  const [state, setState] = useState<State>({ kind: 'starting' });

  // Held in a ref so the interval can check it without being torn down and
  // rebuilt on every send.
  const stopped = useRef(false);

  const send = useCallback(async () => {
    if (stopped.current) return;

    /*
     * Every path to setState goes through this await, including the one where
     * the browser has no geolocation at all. Without that the first call —
     * which the effect makes immediately — could set state synchronously while
     * the effect is still running, which React reports as a cascading render
     * and which the compiler refuses outright.
     */
    const position = await currentPosition();

    if (stopped.current) return;

    if (!position) {
      /*
       * Declined, or no fix. Not an error to shout about — it is the ordinary
       * state of a phone in a shed — so the line simply stops claiming to be
       * sharing, and nothing about the job is affected.
       */
      setState({ kind: 'refused' });
      return;
    }

    try {
      await apiRequest('/api/crew/position', {
        method: 'POST',
        body: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMetres: position.coords.accuracy,
          recordedAt: position.timestamp,
        },
      });

      if (!stopped.current) setState({ kind: 'sharing', at: new Date() });
    } catch {
      // A dead spot between houses. The next tick tries again; there is nothing
      // useful to tell somebody holding a hedge trimmer about a failed POST.
    }
  }, []);

  useEffect(() => {
    stopped.current = false;

    /*
     * A beat before the first one, for two reasons that happen to agree.
     *
     * Asking for a position the instant the card paints throws a permission
     * prompt over a screen somebody is still reading, which is a good way to be
     * dismissed by reflex. And calling straight into `send` from an effect body
     * is a cascading render as far as React is concerned — it can set state, and
     * the compiler will not take the await on trust.
     */
    const first = setTimeout(() => void send(), FIRST_SEND_DELAY_MS);
    const timer = setInterval(() => void send(), EVERY_MS);

    return () => {
      stopped.current = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [send]);

  async function stop() {
    stopped.current = true;
    setState({ kind: 'off' });
    // Delete rather than simply stop sending: what is already stored should go
    // too, or "off" only means "no longer updating".
    await apiRequest('/api/crew/position', { method: 'DELETE' }).catch(() => {});
  }

  if (state.kind === 'off') {
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Not sharing your location. It starts again next time you clock in.
      </p>
    );
  }

  if (state.kind === 'refused') {
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Your location is not being shared — this phone did not give it. You are still
        clocked in.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {state.kind === 'starting' ? (
          'Sharing your location with the office…'
        ) : (
          <>
            Your location is shared with the office. Last sent{' '}
            <time dateTime={state.at.toISOString()}>
              {state.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </time>
            .
          </>
        )}
      </p>

      <Button size="sm" variant="ghost" onClick={() => void stop()}>
        Stop sharing
      </Button>
    </div>
  );
}
