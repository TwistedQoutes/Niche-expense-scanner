'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The glue between the web app and the phone it is running on.
 *
 * Mounted once inside the signed-in shell. Does nothing at all in a browser —
 * every Capacitor import below is dynamic, so none of this code is downloaded
 * by someone using JobFlow at a desk.
 *
 * Three jobs:
 *
 *  1. Register the handset for push notifications, on every launch, because FCM
 *     rotates tokens on its own schedule.
 *  2. Route a tapped notification to the thing it was about.
 *  3. Keep a copy of today's schedule in native storage so `offline.html` has
 *     something to show when the van is out of signal.
 */

type OfflineJob = {
  time: string;
  customer: string;
  service?: string;
  address?: string;
};

export function NativeBridge({ todayJobs }: { todayJobs: OfflineJob[] }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    // Capacitor's listener handles resolve to an object with remove(); collected
    // so a navigation away does not leave two listeners pushing the same route.
    const teardown: Array<() => void> = [];

    async function connect() {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform() || cancelled) return;

      const platform = Capacitor.getPlatform() === 'ios' ? 'IOS' : 'ANDROID';

      // --- Offline copy -----------------------------------------------------
      // Written first, and without waiting for permissions: it is the one thing
      // here that works whether or not anyone agreed to notifications.
      try {
        const { Preferences } = await import('@capacitor/preferences');
        await Preferences.set({
          key: 'jobflow.schedule.today',
          value: JSON.stringify({
            savedAt: new Date().toISOString(),
            heading: 'Today',
            jobs: todayJobs,
          }),
        });
      } catch (error) {
        // An unwritable store is not worth interrupting anyone over; the
        // offline screen degrades to "nothing saved yet".
        console.warn('[native] could not save the offline schedule', error);
      }

      if (cancelled) return;

      // --- Push -------------------------------------------------------------
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');

        // `checkPermissions` first so a launch after someone said no does not
        // re-prompt. iOS only ever shows the system dialog once anyway, but on
        // Android 13+ asking repeatedly is a way to get the app muted.
        const current = await PushNotifications.checkPermissions();
        let granted = current.receive === 'granted';

        if (!granted && current.receive === 'prompt') {
          const asked = await PushNotifications.requestPermissions();
          granted = asked.receive === 'granted';
        }

        if (!granted || cancelled) return;

        // Android 8 and later drop a notification whose channel does not exist,
        // without an error anywhere. The id must match the one the server sets
        // on an Android message (src/lib/push/fcm.ts) and the manifest's
        // default_notification_channel_id. A no-op on iOS.
        if (platform === 'ANDROID') {
          try {
            await PushNotifications.createChannel({
              id: 'leads',
              name: 'New leads and jobs',
              description: 'A new enquiry, or a job added to your schedule.',
              // IMPORTANCE_HIGH: this is the notification the app exists for,
              // and it has to arrive while the phone is on a dashboard.
              importance: 5,
              visibility: 1,
              vibration: true,
            });
          } catch (error) {
            console.warn('[native] could not create the notification channel', error);
          }
        }

        const registration = await PushNotifications.addListener(
          'registration',
          (token: { value: string }) => {
            void fetch('/api/native/devices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: token.value, platform }),
            }).catch(() => {
              // Offline at launch is ordinary. The next launch registers.
            });
          },
        );
        teardown.push(() => void registration.remove());

        const failure = await PushNotifications.addListener(
          'registrationError',
          (error: unknown) => {
            console.warn('[native] push registration was refused', error);
          },
        );
        teardown.push(() => void failure.remove());

        const tapped = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action: { notification: { data?: Record<string, unknown> } }) => {
            const path = action.notification.data?.path;

            // Only a same-origin path is ever followed. The payload arrives
            // from a push service, and a notification that could send a tap to
            // an arbitrary URL inside an authenticated webview is a phishing
            // primitive. A leading slash with no second slash is the test:
            // "//evil.example" is protocol-relative and must not pass.
            if (typeof path === 'string' && /^\/(?!\/)/.test(path)) {
              router.push(path);
            }
          },
        );
        teardown.push(() => void tapped.remove());

        await PushNotifications.register();
      } catch (error) {
        console.warn('[native] push is unavailable on this device', error);
      }
    }

    void connect();

    return () => {
      cancelled = true;
      teardown.forEach((remove) => remove());
    };
  }, [router, todayJobs]);

  return null;
}
