import type { Metadata } from 'next';
import Link from 'next/link';

import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE } from '@/components/jobs/status';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAuth } from '@/lib/auth/context';
import {
  formatDayHeading,
  formatTimeLabel,
  instantToWallClock,
  localWeekDays,
} from '@/lib/dates';
import { formatCents, formatCentsCompact } from '@/lib/money';
import { loadCalendar, loadUnscheduledJobs } from '@/lib/scheduling/repository';

export const metadata: Metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const auth = await requireAuth();
  const { date, view } = await searchParams;

  const timeZone = auth.organization.timezone;

  // "Today" is the business's today, not the server's.
  const wall = instantToWallClock(new Date(), timeZone);
  const today = [
    String(wall.year).padStart(4, '0'),
    String(wall.month).padStart(2, '0'),
    String(wall.day).padStart(2, '0'),
  ].join('-');

  const anchor = date && DATE_PATTERN.test(date) ? date : today;
  const mode = view === 'day' ? 'day' : 'week';

  const [calendar, unscheduled] = await Promise.all([
    loadCalendar(auth.db, timeZone, { anchorDate: anchor, view: mode }),
    loadUnscheduledJobs(auth.db),
  ]);

  const week = localWeekDays(anchor, timeZone) ?? [anchor];
  const shift = (days: number) => {
    const [year, month, day] = anchor.split('-').map(Number) as [number, number, number];
    const moved = new Date(Date.UTC(year, month - 1, day + days));
    return moved.toISOString().slice(0, 10);
  };

  const step = mode === 'day' ? 1 : 7;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Calendar</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {mode === 'day'
              ? formatDayHeading(anchor)
              : `${formatDayHeading(week[0]!)} – ${formatDayHeading(week.at(-1)!)}`}
            {' · '}
            {formatCentsCompact(calendar.totalEstimatedRevenueCents, auth.organization.currency)}{' '}
            booked
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
            <Link
              href={`/calendar?view=day&date=${anchor}`}
              className={
                mode === 'day'
                  ? 'bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
              }
            >
              Day
            </Link>
            <Link
              href={`/calendar?view=week&date=${anchor}`}
              className={
                mode === 'week'
                  ? 'bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
              }
            >
              Week
            </Link>
          </div>

          <div className="flex items-center gap-1">
            <Link
              href={`/calendar?view=${mode}&date=${shift(-step)}`}
              aria-label={mode === 'day' ? 'Previous day' : 'Previous week'}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
            >
              ←
            </Link>
            <Link
              href={`/calendar?view=${mode}`}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
            >
              Today
            </Link>
            <Link
              href={`/calendar?view=${mode}&date=${shift(step)}`}
              aria-label={mode === 'day' ? 'Next day' : 'Next week'}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
            >
              →
            </Link>
          </div>
        </div>
      </div>

      {unscheduled.length > 0 ? (
        <Card>
          <CardHeader
            title="Waiting for a date"
            description="Accepted work with nothing in the diary yet."
          />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {unscheduled.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-800 dark:text-slate-200">
                      {job.title}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {job.customer.firstName} {job.customer.lastName ?? ''} · {job.number}
                    </span>
                  </span>
                  <span className="tabular text-sm text-slate-600 dark:text-slate-300">
                    {formatCents(job.priceCents, auth.organization.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/*
        A scrolling column set on a phone, a seven-column grid on a desktop. A
        true time-grid calendar is the wrong shape for a one-handed check in a
        truck, which is where this gets read.
      */}
      <div className="grid gap-3 lg:grid-cols-7">
        {calendar.days.map((day) => (
          <section
            key={day.date}
            className={
              day.date === today
                ? 'rounded-xl bg-white ring-2 ring-brand-500 dark:bg-slate-900'
                : 'rounded-xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800'
            }
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
              <h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatDayHeading(day.date)}
                {day.date === today ? (
                  <span className="ml-1.5 text-xs font-normal text-brand-600 dark:text-brand-400">
                    today
                  </span>
                ) : null}
              </h2>
              {day.appointments.length > 0 ? (
                <span className="tabular text-xs text-slate-400 dark:text-slate-500">
                  {Math.round((day.bookedMinutes / 60) * 10) / 10}h
                </span>
              ) : null}
            </header>

            {day.appointments.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-400 dark:text-slate-500">Nothing booked.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {day.appointments.map((appointment) => (
                  <li key={appointment.id} className="px-3 py-2">
                    {appointment.job ? (
                      <Link href={`/jobs/${appointment.job.id}`} className="block hover:underline">
                        <AppointmentBody appointment={appointment} timeZone={timeZone} />
                      </Link>
                    ) : (
                      <AppointmentBody appointment={appointment} timeZone={timeZone} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {calendar.days.every((day) => day.appointments.length === 0) && unscheduled.length === 0 ? (
        <EmptyState
          title="Nothing in the diary"
          description="Accept a quote, or add a job by hand, and it will show up here once you give it a date."
        />
      ) : null}
    </div>
  );
}

function AppointmentBody({
  appointment,
  timeZone,
}: {
  appointment: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    status: keyof typeof APPOINTMENT_STATUS_LABEL;
    addressLine1: string | null;
    city: string | null;
    customer: { firstName: string; lastName: string | null } | null;
  };
  timeZone: string;
}) {
  return (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="tabular text-xs font-medium text-slate-900 dark:text-slate-100">
          {formatTimeLabel(appointment.startsAt, timeZone)}
        </span>
        <Badge tone={APPOINTMENT_STATUS_TONE[appointment.status]}>
          {APPOINTMENT_STATUS_LABEL[appointment.status]}
        </Badge>
      </span>

      <span className="mt-0.5 block truncate text-sm text-slate-800 dark:text-slate-200">
        {appointment.title}
      </span>

      {appointment.customer ? (
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
          {appointment.customer.firstName} {appointment.customer.lastName ?? ''}
        </span>
      ) : null}

      {appointment.addressLine1 ? (
        <span className="block truncate text-xs text-slate-400 dark:text-slate-500">
          {appointment.addressLine1}
          {appointment.city ? `, ${appointment.city}` : ''}
        </span>
      ) : null}
    </>
  );
}
