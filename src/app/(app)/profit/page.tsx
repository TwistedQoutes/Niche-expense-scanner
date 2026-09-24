import { Role } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/ui/StatCard';
import { hasRole, requireAuth } from '@/lib/auth/context';
import { loadProfitReport, type GroupProfit, type JobProfit } from '@/lib/costs/report';
import { addDays, formatDateTimeLabel } from '@/lib/dates';
import { formatCents } from '@/lib/money';

export const metadata: Metadata = { title: 'Profit' };
export const dynamic = 'force-dynamic';

const RANGES = {
  '7': { label: 'Last 7 days', days: 7 },
  '30': { label: 'Last 30 days', days: 30 },
  '90': { label: 'Last 90 days', days: 90 },
  all: { label: 'All time', days: null },
} as const;

type RangeKey = keyof typeof RANGES;

function isRangeKey(value: string | undefined): value is RangeKey {
  return value !== undefined && value in RANGES;
}

function margin(bps: number | null): string {
  return bps === null ? '—' : `${(bps / 100).toFixed(1)}%`;
}

/**
 * Which jobs made money, and which ones only looked like they did.
 *
 * The job page can tell you a single job lost money. It cannot tell you that
 * every job for one customer does, or that the service you sell most of is the
 * one you earn least on — those are only visible with the jobs lined up and
 * sorted by the thing that matters.
 *
 * So the default order is worst margin first. Not newest, which is a diary, and
 * not biggest, which flatters: the $12 loss on an $80 mow is a worse business
 * than the $40 profit on a $4,000 install, and sorting by money would bury the
 * first behind the second.
 *
 * Owners and admins only, like everything else derived from pay. The whole page
 * is a payroll read through a different lens.
 */
export default async function ProfitPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const auth = await requireAuth();

  /*
   * Not-found rather than a refusal. A crew member who followed a link here
   * should not learn that a screen about wages exists — the same way /admin
   * answers a prober.
   */
  if (!hasRole(auth, Role.ADMIN)) notFound();

  const { range } = await searchParams;
  const key: RangeKey = isRangeKey(range) ? range : '30';
  const days = RANGES[key].days;
  const since = days === null ? undefined : addDays(new Date(), -days);

  const report = await loadProfitReport(auth.db, auth.organization.id, { since });
  const currency = auth.organization.currency;
  const money = (cents: number) => formatCents(cents, currency);

  const nothingYet = report.ranked.length === 0 && report.uncosted.length === 0;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Profit</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            What the work kept, once the hours, the driving and the fuel are taken off.
          </p>
        </div>

        <nav className="flex flex-wrap gap-1" aria-label="Period">
          {Object.entries(RANGES).map(([value, option]) => (
            <Link
              key={value}
              href={`/profit?range=${value}`}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                value === key
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      {nothingYet ? (
        <EmptyState
          title="No finished jobs in this period"
          description="Profit is worked out from completed jobs. Finish one and it appears here."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Charged" value={money(report.totals.chargedCents)} />
            <StatCard label="Cost to do" value={money(report.totals.costCents)} />
            <StatCard
              label="Kept"
              value={money(report.totals.keptCents)}
              hint={`${margin(report.totals.marginBps)} of what you charged`}
            />
            <StatCard
              label="Jobs counted"
              value={String(report.totals.jobs)}
              hint={
                report.uncosted.length > 0
                  ? `${report.uncosted.length} not counted yet`
                  : 'every finished job'
              }
            />
          </div>

          {/*
            * The caveat, before the numbers rather than under them.
            *
            * A headline an owner repeats to their accountant has to be built on
            * jobs that were fully costed. Saying which ones were left out, and
            * what they are waiting on, is what makes the figure above safe to
            * quote — and the fix is never per job, it is one pay rate or one
            * fuel price that unblocks forty rows at once.
            */}
          {report.uncosted.length > 0 ? (
            <Card>
              <CardHeader
                title={`${report.uncosted.length} ${
                  report.uncosted.length === 1 ? 'job is' : 'jobs are'
                } not in those totals`}
                description="Their cost is not known yet, so counting them would make the figures above look better than they are."
              />
              <ul className="space-y-1 p-4 pt-0 text-sm text-slate-600 dark:text-slate-300">
                {report.blockers.map((blocker) => (
                  <li key={blocker.part}>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {blocker.jobs} {blocker.jobs === 1 ? 'job' : 'jobs'}
                    </span>
                    {' — '}
                    {blocker.reason}{' '}
                    {blocker.part === 'labour' ? (
                      <Link href="/team" className="underline underline-offset-2">
                        Set pay rates
                      </Link>
                    ) : (
                      <Link href="/pricing-settings" className="underline underline-offset-2">
                        Set fuel and mileage
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {report.losing.length > 0 ? (
            <Card>
              <CardHeader
                title={`${report.losing.length} ${
                  report.losing.length === 1 ? 'job cost' : 'jobs cost'
                } more than ${report.losing.length === 1 ? 'it' : 'they'} charged`}
                description="Worth checking the price, the travel, or whether they can be grouped with something nearby."
              />
              <JobTable rows={report.losing} money={money} timeZone={auth.organization.timezone} />
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="By customer"
                description="Thinnest margin first. A customer can be loyal and still cost you money."
              />
              <GroupTable rows={report.byCustomer} money={money} />
            </Card>

            <Card>
              <CardHeader
                title="By service"
                description="The one you sell most of is not always the one you earn most on."
              />
              <GroupTable rows={report.byService} money={money} />
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Every finished job"
              description="Thinnest margin first, which is the order worth reading."
            />
            <JobTable rows={report.ranked} money={money} timeZone={auth.organization.timezone} />
          </Card>
        </>
      )}
    </div>
  );
}

function JobTable({
  rows,
  money,
  timeZone,
}: {
  rows: JobProfit[];
  money: (cents: number) => string;
  timeZone: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="p-4 pt-0 text-sm text-slate-500 dark:text-slate-400">
        Nothing to show for this period.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row) => {
        const charged = row.cost.totalCostCents + row.cost.profitCents;
        const losing = row.cost.profitCents < 0;

        return (
          <li key={row.jobId} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <Link
                  href={`/jobs/${row.jobId}`}
                  className="text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
                >
                  {row.title}
                </Link>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  <span className="tabular">{row.number}</span> · {row.customerName}
                  {row.completedAt ? ` · ${formatDateTimeLabel(row.completedAt, timeZone)}` : ''}
                </p>
              </div>

              <div className="flex items-baseline gap-3">
                <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                  {money(charged)} − {money(row.cost.totalCostCents)}
                </span>
                <span
                  className={`tabular text-sm font-semibold ${
                    losing
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {money(row.cost.profitCents)}
                </span>
                <Badge tone={losing ? 'danger' : 'neutral'}>
                  {row.cost.marginBps === null ? '—' : `${(row.cost.marginBps / 100).toFixed(0)}%`}
                </Badge>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function GroupTable({
  rows,
  money,
}: {
  rows: GroupProfit[];
  money: (cents: number) => string;
}) {
  if (rows.length === 0) {
    return (
      <p className="p-4 pt-0 text-sm text-slate-500 dark:text-slate-400">
        Nothing costed in this period yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.slice(0, 10).map((row) => (
        <li key={row.key} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-800 dark:text-slate-200">{row.label}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {row.jobs} {row.jobs === 1 ? 'job' : 'jobs'} · {money(row.chargedCents)} charged
            </p>
          </div>

          <div className="flex items-baseline gap-2">
            <span
              className={`tabular text-sm font-medium ${
                row.keptCents < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {money(row.keptCents)}
            </span>
            <Badge tone={row.keptCents < 0 ? 'danger' : 'neutral'}>{margin(row.marginBps)}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
