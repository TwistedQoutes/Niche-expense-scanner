import { Role } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RoutePlanner } from '@/components/routing/RoutePlanner';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { hasRole, requireAuth } from '@/lib/auth/context';
import { instantToWallClock, toLocalTimeValue } from '@/lib/dates';
import { formatDistance } from '@/lib/geo/distance';
import { isReordered, loadDayRoute, type RouteStop } from '@/lib/routing/repository';

export const metadata: Metadata = { title: 'Route' };
export const dynamic = 'force-dynamic';

function today(timeZone: string): string {
  const wall = instantToWallClock(new Date(), timeZone);
  return [
    String(wall.year).padStart(4, '0'),
    String(wall.month).padStart(2, '0'),
    String(wall.day).padStart(2, '0'),
  ].join('-');
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The day, and a shorter way round it.
 *
 * Two columns: what is booked, and what this would do instead. Side by side
 * rather than as a single list with an "optimise" button, because the owner is
 * being asked to decide — and a decision needs both options visible. A screen
 * that replaced the day with a better version and told you afterwards would be
 * asking for trust it has not earned yet.
 *
 * The distances are straight lines and say so everywhere they appear. A river or
 * a one-way system can make two gardens four hundred yards apart a ten-minute
 * drive, and a number labelled "miles" that is not road miles is exactly the
 * sort of thing somebody would plan a morning around. What crow-flies distance
 * is reliably good at is deciding the *order*, which is what this produces; the
 * figures beside it are there to compare one order against another.
 */
export default async function RoutePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const auth = await requireAuth();

  // Reordering a day changes times customers have been told. That is not a
  // decision for whoever happens to be holding a phone.
  if (!hasRole(auth, Role.ADMIN)) notFound();

  const timeZone = auth.organization.timezone;
  const { date: requested } = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? '') ? requested! : today(timeZone);

  const route = await loadDayRoute(auth.db, auth.organization.id, timeZone, date);

  const changed = isReordered(
    route.booked.filter((stop) => stop.latitude !== null),
    route.suggested,
  );

  const savedLabel =
    route.savedMetres > 0
      ? `About ${formatDistance(route.savedMetres / 0.3048)} less driving, as the crow flies.`
      : 'No shorter order found — the day is already in a sensible sequence.';

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Route</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            The day&rsquo;s stops, and a shorter way round them.
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Link
            href={`/route?date=${shiftDate(date, -1)}`}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            ← Previous
          </Link>
          <span className="tabular px-2 text-sm font-medium text-slate-900 dark:text-slate-100">
            {date}
          </span>
          <Link
            href={`/route?date=${shiftDate(date, 1)}`}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Next →
          </Link>
        </div>
      </div>

      {route.booked.length === 0 ? (
        <EmptyState
          title="Nothing booked for this day"
          description="Book some jobs onto the calendar and the route appears here."
        />
      ) : (
        <>
          {route.startsFromFirstJob ? (
            <Card>
              <CardHeader
                title="No business address set"
                description="The route is ordered from the first job of the day instead of from your yard, which is a rougher plan than it needs to be."
              />
              <p className="p-4 pt-0 text-sm">
                <Link href="/settings" className="underline underline-offset-2">
                  Add your address in Settings
                </Link>{' '}
                and the first stop will be chosen properly too.
              </p>
            </Card>
          ) : null}

          {route.unplaceable.length > 0 ? (
            <Card>
              <CardHeader
                title={`${route.unplaceable.length} ${
                  route.unplaceable.length === 1 ? 'stop has' : 'stops have'
                } no location`}
                description="They are left where they are rather than dropped — a job missing from the plan is a job that does not get done."
              />
              <ul className="space-y-1 p-4 pt-0 text-sm text-slate-600 dark:text-slate-300">
                {route.unplaceable.map((stop) => (
                  <li key={stop.appointmentId}>
                    {stop.title}
                    {stop.address ? ` — ${stop.address}` : ' — no address on the job'}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="As booked"
                description={
                  route.currentMetres > 0
                    ? `About ${formatDistance(route.currentMetres / 0.3048)} of driving, as the crow flies.`
                    : 'Not enough placed stops to measure.'
                }
              />
              <StopList stops={route.booked} timeZone={timeZone} showTimes />
            </Card>

            <Card>
              <CardHeader
                title="Suggested order"
                description={
                  route.plannedMetres > 0
                    ? `About ${formatDistance(route.plannedMetres / 0.3048)}, straight-line. ${savedLabel}`
                    : savedLabel
                }
              />
              <StopList stops={route.suggested} timeZone={timeZone} numbered />

              {changed && route.suggested.length >= 2 ? (
                <div className="p-4 pt-0">
                  <RoutePlanner
                    date={date}
                    order={route.suggested.map((stop) => stop.appointmentId)}
                    stopCount={route.suggested.length}
                    savedLabel={savedLabel}
                  />
                </div>
              ) : (
                <p className="p-4 pt-0 text-sm text-slate-500 dark:text-slate-400">
                  {route.suggested.length < 2
                    ? 'A route needs at least two placed stops.'
                    : 'Already in this order — nothing to change.'}
                </p>
              )}
            </Card>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500">
            Distances are measured in straight lines, not along roads. They are reliable for
            deciding the order and only an estimate of the mileage.
          </p>
        </>
      )}
    </div>
  );
}

function StopList({
  stops,
  timeZone,
  numbered = false,
  showTimes = false,
}: {
  stops: RouteStop[];
  timeZone: string;
  numbered?: boolean;
  showTimes?: boolean;
}) {
  if (stops.length === 0) {
    return (
      <p className="p-4 pt-0 text-sm text-slate-500 dark:text-slate-400">Nothing here.</p>
    );
  }

  return (
    <ol className="divide-y divide-slate-100 dark:divide-slate-800">
      {stops.map((stop, index) => (
        <li key={stop.appointmentId} className="flex items-baseline gap-3 px-4 py-2.5">
          {numbered ? (
            <span className="tabular w-5 shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500">
              {index + 1}
            </span>
          ) : null}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-900 dark:text-slate-100">
              {stop.jobId ? (
                <Link href={`/jobs/${stop.jobId}`} className="hover:underline">
                  {stop.title}
                </Link>
              ) : (
                stop.title
              )}
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {[stop.customerName, stop.address].filter(Boolean).join(' · ') || 'No address'}
            </p>
          </div>

          <span className="tabular shrink-0 text-xs text-slate-500 dark:text-slate-400">
            {showTimes ? toLocalTimeValue(stop.startsAt, timeZone) : `${stop.durationMinutes}m`}
          </span>

          {stop.latitude === null ? <Badge tone="neutral">no location</Badge> : null}
        </li>
      ))}
    </ol>
  );
}
