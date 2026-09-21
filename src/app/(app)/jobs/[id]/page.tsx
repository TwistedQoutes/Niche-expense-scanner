import { JobStatus } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JobActions } from '@/components/jobs/JobActions';
import { JobCostCard } from '@/components/jobs/JobCostCard';
import { JobPhotos } from '@/components/jobs/JobPhotos';
import { ScheduleForm } from '@/components/jobs/ScheduleForm';
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  JOB_STATUS_LABEL,
  JOB_STATUS_TONE,
} from '@/components/jobs/status';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { Role } from '@prisma/client';

import { hasRole, requireAuth } from '@/lib/auth/context';
import { jobCost, maySeeJobCosts } from '@/lib/costs/repository';
import { listJobPhotos } from '@/lib/files/repository';
import { MAX_UPLOAD_BYTES, storageEnabled } from '@/lib/storage';
import {
  formatDateTimeLabel,
  formatRelative,
  instantToWallClock,
  toLocalDateValue,
  toLocalTimeValue,
} from '@/lib/dates';
import { getJob } from '@/lib/jobs/repository';
import { formatCents } from '@/lib/money';
import { AppError } from '@/lib/api/errors';

export const metadata: Metadata = { title: 'Job' };
export const dynamic = 'force-dynamic';

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;

  const job = await getJob(auth.db, id).catch((error: unknown) => {
    // A job in another workspace is indistinguishable from one that never
    // existed, which is the point.
    if (error instanceof AppError && error.code === 'not_found') notFound();
    throw error;
  });

  const timeZone = auth.organization.timezone;
  const appointment = job.appointments[0] ?? null;

  const photos = await listJobPhotos(auth.db, job.id);

  /*
   * What the job cost, for the people entitled to know.
   *
   * Not fetched at all for crew: the labour line is one person's wage, and the
   * cheapest way to keep a payroll private is not to send it. See
   * src/lib/costs/repository.ts.
   */
  const cost = maySeeJobCosts(auth.role) ? await jobCost(auth.db, auth.organization.id, job.id) : null;

  const teammates = await auth.db.membership.findMany({
    where: { status: 'ACTIVE' },
    select: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // Tomorrow at 9, in the business's own clock, as a sensible starting point.
  const now = new Date();
  const wall = instantToWallClock(now, timeZone);
  const tomorrow = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1));
  const defaultDate = appointment
    ? toLocalDateValue(appointment.startsAt, timeZone)
    : tomorrow.toISOString().slice(0, 10);
  const defaultTime = appointment ? toLocalTimeValue(appointment.startsAt, timeZone) : '09:00';
  const defaultDuration = appointment
    ? Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000)
    : 60;

  const customerName = [job.customer.firstName, job.customer.lastName].filter(Boolean).join(' ');
  const finished = job.status === JobStatus.COMPLETED || job.status === JobStatus.CANCELLED;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="tabular text-xs text-slate-400 dark:text-slate-500">{job.number}</span>
            <Badge tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Badge>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
            {job.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <Link href={`/customers/${job.customer.id}`} className="hover:underline">
              {customerName}
            </Link>
            {job.quote ? (
              <>
                {' · from '}
                <Link href={`/quotes/${job.quote.id}`} className="hover:underline">
                  {job.quote.number}
                </Link>
              </>
            ) : null}
          </p>
        </div>

        <div className="text-right">
          <p className="tabular text-lg font-semibold text-slate-900 dark:text-slate-50">
            {formatCents(job.priceCents, job.currency)}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {job.status === JobStatus.COMPLETED ? 'charged' : 'agreed'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title={appointment ? 'On the calendar' : 'Not booked yet'}
              description={
                appointment
                  ? `${formatDateTimeLabel(appointment.startsAt, timeZone)} – ${formatDateTimeLabel(appointment.endsAt, timeZone)}`
                  : 'A customer who has accepted and heard nothing is the easiest job to lose.'
              }
            />

            <div className="p-4 pt-0">
              {finished ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {job.status === JobStatus.COMPLETED
                    ? `Completed ${job.completedAt ? formatDateTimeLabel(job.completedAt, timeZone) : ''}.`
                    : `Cancelled${job.cancelReason ? `: ${job.cancelReason}` : '.'}`}
                </p>
              ) : (
                <ScheduleForm
                  jobId={job.id}
                  defaultDate={defaultDate}
                  defaultTime={defaultTime}
                  defaultDurationMinutes={defaultDuration}
                  teammates={teammates.map((membership) => membership.user)}
                  assignedUserId={job.assignedUserId}
                  rescheduling={appointment !== null}
                />
              )}
            </div>
          </Card>

          {job.description ? (
            <Card>
              <CardHeader title="What was agreed" />
              <div className="p-4 pt-0">
                <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                  {job.description}
                </p>
              </div>
            </Card>
          ) : null}

          {job.completionNotes ? (
            <Card>
              <CardHeader title="How it went" />
              <div className="p-4 pt-0">
                <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                  {job.completionNotes}
                </p>
              </div>
            </Card>
          ) : null}

          <JobPhotos
            jobId={job.id}
            photos={photos}
            storageConfigured={storageEnabled()}
            canDelete={hasRole(auth, Role.ADMIN)}
            maxBytes={MAX_UPLOAD_BYTES}
          />
        </div>

        <div className="space-y-4">
          {cost ? <JobCostCard cost={cost} currency={job.currency} /> : null}

          <Card>
            <CardHeader title="Move it on" />
            <div className="p-4 pt-0">
              <JobActions
                jobId={job.id}
                status={job.status}
                priceCents={job.priceCents}
                customerName={job.customer.firstName}
              />
              {finished ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Nothing left to do here.
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-2 p-4 pt-0 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Created</dt>
                <dd className="text-slate-700 dark:text-slate-300">
                  {formatRelative(job.createdAt)}
                </dd>
              </div>

              {job.service ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500 dark:text-slate-400">Service</dt>
                  <dd className="text-slate-700 dark:text-slate-300">{job.service.name}</dd>
                </div>
              ) : null}

              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Assigned to</dt>
                <dd className="text-slate-700 dark:text-slate-300">
                  {job.assignedUser?.name ?? 'Nobody yet'}
                </dd>
              </div>

              {job.startedAt ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500 dark:text-slate-400">Started</dt>
                  <dd className="text-slate-700 dark:text-slate-300">
                    {formatDateTimeLabel(job.startedAt, timeZone)}
                  </dd>
                </div>
              ) : null}

              {job.customer.phone ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500 dark:text-slate-400">Phone</dt>
                  <dd className="text-slate-700 dark:text-slate-300">
                    <a href={`tel:${job.customer.phone}`} className="hover:underline">
                      {job.customer.phone}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </Card>

          {job.appointments.length > 0 ? (
            <Card>
              <CardHeader title="Visits" />
              <ul className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
                {job.appointments.map((visit) => (
                  <li key={visit.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      {formatDateTimeLabel(visit.startsAt, timeZone)}
                    </span>
                    <Badge tone={APPOINTMENT_STATUS_TONE[visit.status]}>
                      {APPOINTMENT_STATUS_LABEL[visit.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
