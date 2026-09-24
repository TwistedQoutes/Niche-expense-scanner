import { JobStatus } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';

import { JOB_STATUS_LABEL, JOB_STATUS_ORDER, JOB_STATUS_TONE } from '@/components/jobs/status';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAuth } from '@/lib/auth/context';
import { formatDateTimeLabel, formatRelative } from '@/lib/dates';
import { jobCounts, listJobs } from '@/lib/jobs/repository';
import { formatCents } from '@/lib/money';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

function isJobStatus(value: string | undefined): value is JobStatus {
  return value !== undefined && (Object.values(JobStatus) as string[]).includes(value);
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const auth = await requireAuth();
  const { status } = await searchParams;

  const filter = isJobStatus(status) ? status : undefined;
  const timeZone = auth.organization.timezone;

  const [{ jobs }, counts] = await Promise.all([
    listJobs(auth.db, { status: filter, limit: 100 }),
    jobCounts(auth.db),
  ]);

  const needingDates = counts[JobStatus.SCHEDULED];

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Jobs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Work you have won. Give it a date, then mark it done.
          </p>
        </div>

        <Link
          href="/calendar"
          className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Open calendar
        </Link>
      </div>

      {needingDates > 0 && !filter ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900">
          {needingDates === 1
            ? 'One job still needs a date.'
            : `${needingDates} jobs still need a date.`}{' '}
          A customer who has accepted and heard nothing since is the easiest job to lose.
        </p>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label="Filter jobs by status">
        <Link
          href="/jobs"
          aria-current={filter ? undefined : 'page'}
          className={
            filter
              ? 'rounded-full px-3 py-1 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800'
              : 'rounded-full bg-slate-900 px-3 py-1 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900'
          }
        >
          All
        </Link>

        {JOB_STATUS_ORDER.map((value) => (
          <Link
            key={value}
            href={`/jobs?status=${value}`}
            aria-current={filter === value ? 'page' : undefined}
            className={
              filter === value
                ? 'rounded-full bg-slate-900 px-3 py-1 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900'
                : 'rounded-full px-3 py-1 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800'
            }
          >
            {JOB_STATUS_LABEL[value]}
            <span className="tabular ml-1.5 text-xs opacity-70">{counts[value]}</span>
          </Link>
        ))}
      </nav>

      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
        {jobs.length === 0 ? (
          <EmptyState
            title={filter ? `No ${JOB_STATUS_LABEL[filter].toLowerCase()} jobs` : 'No jobs yet'}
            description={
              filter
                ? 'Try another tab.'
                : 'A job appears here the moment a customer accepts a quote.'
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {jobs.map((job) => {
              const next = job.appointments[0];

              return (
                <li key={job.id}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="tabular text-xs text-slate-400 dark:text-slate-500">
                      {job.number}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {job.title}
                      </span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                        {job.customer.firstName} {job.customer.lastName ?? ''}
                        {next
                          ? ` · ${formatDateTimeLabel(next.startsAt, timeZone)}`
                          : job.status === JobStatus.SCHEDULED
                            ? ' · no date yet'
                            : ''}
                      </span>
                    </span>

                    <span className="tabular text-sm text-slate-700 dark:text-slate-300">
                      {formatCents(job.priceCents, job.currency)}
                    </span>

                    <Badge tone={JOB_STATUS_TONE[job.status]}>
                      {JOB_STATUS_LABEL[job.status]}
                    </Badge>

                    <span className="hidden text-xs text-slate-400 sm:block dark:text-slate-500">
                      {formatRelative(job.createdAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
