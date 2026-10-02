import { redirect } from 'next/navigation';

import { BottomNav } from '@/components/layout/BottomNav';
import { DemoBanner } from '@/components/layout/DemoBanner';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { NativeBridge } from '@/components/native/NativeBridge';
import { hasRole, redirectForFailure, resolveAuth, type AuthContext } from '@/lib/auth/context';
import { instantToWallClock } from '@/lib/dates';
import { nativePlatform, hidesPurchasing } from '@/lib/native/platform';
import { loadDayRoute } from '@/lib/routing/repository';

/**
 * The signed-in shell.
 *
 * This is where authorisation actually happens for every application page.
 * `src/proxy.ts` only checks that a cookie exists — it runs at the edge and
 * cannot read the database — so the real decision is made here, once, in a
 * server component that every page under (app) renders inside.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const outcome = await resolveAuth();

  if (!outcome.ok) {
    // Not always /login. A cookie that is valid but no longer usable has to be
    // cleared first, or the proxy sends them right back here — see
    // redirectForFailure and src/app/api/auth/session-ended.
    redirect(redirectForFailure(outcome.reason));
  }

  const auth = outcome.context;

  const platform = await nativePlatform();

  // Resolved on the server so the billing entry is absent from the HTML in the
  // native apps rather than hidden in it.
  const hidePurchasing = hidesPurchasing(platform);

  // Only the phones pay for this query. A browser never renders NativeBridge,
  // so loading a day's route for every desktop page view would be work nobody
  // reads.
  const todayJobs = platform === null ? [] : await offlineSchedule(auth);

  return (
    <div className="flex min-h-dvh flex-col">
      {auth.organization.isDemo ? <DemoBanner /> : null}

      <TopBar
        organizationName={auth.organization.name}
        userName={auth.user.name}
        userEmail={auth.user.email}
      />

      <div className="flex flex-1">
        <Sidebar
          canSeeAdminItems={hasRole(auth, 'ADMIN')}
          isPlatformAdmin={auth.user.isPlatformAdmin}
          hidePurchasing={hidePurchasing}
        />

        {/* The bottom padding clears the mobile nav bar, which is fixed. */}
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
      </div>

      <BottomNav />

      {platform === null ? null : <NativeBridge todayJobs={todayJobs} />}
    </div>
  );
}

/**
 * Today's stops, flattened for the offline screen.
 *
 * Deliberately a handful of plain strings rather than the route objects: this
 * is written into native storage and read by `native/www/offline.html`, a page
 * with no access to the app's types or formatting helpers, so everything it
 * needs is already a string by the time it gets there.
 */
async function offlineSchedule(auth: AuthContext) {
  try {
    const timeZone = auth.organization.timezone;
    const wall = instantToWallClock(new Date(), timeZone);
    const date = [
      String(wall.year).padStart(4, '0'),
      String(wall.month).padStart(2, '0'),
      String(wall.day).padStart(2, '0'),
    ].join('-');

    const route = await loadDayRoute(auth.db, auth.organization.id, timeZone, date);

    return route.booked.map((stop) => ({
      time: new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      }).format(stop.startsAt),
      customer: stop.customerName,
      service: stop.title,
      address: stop.address ?? undefined,
    }));
  } catch (error) {
    // The offline copy is a convenience. Failing to build it must never stop
    // the app's shell from rendering.
    console.warn('[native] could not build the offline schedule', error);
    return [];
  }
}
