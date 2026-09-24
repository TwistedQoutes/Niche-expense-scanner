import type { Metadata } from 'next';
import Link from 'next/link';

import { BarList } from '@/components/charts/BarList';
import { FunnelChart } from '@/components/charts/FunnelChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/ui/StatCard';
import { requireAuth } from '@/lib/auth/context';
import { loadAnalytics } from '@/lib/analytics/reports';
import { addDays, formatMonthLabel, formatMonthShort } from '@/lib/dates';
import { formatCents, formatCentsCompact } from '@/lib/money';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

const RANGES = {
  '30': { label: 'Last 30 days', days: 30 },
  '90': { label: 'Last 90 days', days: 90 },
  '365': { label: 'Last 12 months', days: 365 },
  all: { label: 'All time', days: null },
} as const;

type RangeKey = keyof typeof RANGES;

function isRangeKey(value: string | undefined): value is RangeKey {
  return value !== undefined && value in RANGES;
}

/** Hours, said the way a person would say them. */
function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} hr`;
  return `${Math.round(hours / 24)} days`;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const auth = await requireAuth();
  const { range } = await searchParams;

  const now = new Date();
  const key: RangeKey = isRangeKey(range) ? range : '90';
  const days = RANGES[key].days;
  const since = days === null ? undefined : addDays(now, -days);

  const report = await loadAnalytics(auth.db, { since, now });
  const currency = auth.organization.currency;

  const totalRevenue = report.monthly.reduce((sum, point) => sum + point.revenueCents, 0);
  const thisMonth = report.monthly.at(-1);
  const lastMonth = report.monthly.at(-2);

  const won = report.funnel.find((stage) => stage.key === 'won')?.count ?? 0;
  const leadCount = report.funnel[0]?.count ?? 0;
  const winRate = leadCount === 0 ? 0 : Math.round((won / leadCount) * 100);

  const hasAnything = leadCount > 0 || totalRevenue > 0;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Analytics</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Where the work comes from, what it is worth, and how fast you answer.
          </p>
        </div>

        {/* Filters in one row above the charts. */}
        <nav className="flex flex-wrap gap-2" aria-label="Date range">
          {Object.entries(RANGES).map(([value, option]) => (
            <Link
              key={value}
              href={`/analytics?range=${value}`}
              aria-current={key === value ? 'page' : undefined}
              className={
                key === value
                  ? 'rounded-full bg-slate-900 px-3 py-1 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'rounded-full px-3 py-1 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800'
              }
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      {!hasAnything ? (
        <EmptyState
          title="Nothing to report yet"
          description="Once leads arrive and jobs are completed, this page shows the trend, the funnel and which sources are actually worth your money."
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Revenue, 12 months"
          value={formatCentsCompact(totalRevenue, currency)}
          hint="completed jobs"
        />
        <StatCard
          label="This month"
          value={formatCentsCompact(thisMonth?.revenueCents ?? 0, currency)}
          hint={lastMonth ? `${formatCentsCompact(lastMonth.revenueCents, currency)} last month` : undefined}
        />
        <StatCard label="Win rate" value={`${winRate}%`} hint="leads that became work" />
        <StatCard
          label="Time to quote"
          value={formatHours(report.speed.medianHoursToQuote)}
          hint="median, lead to quote sent"
        />
      </div>

      <Card>
        <CardHeader
          title="Revenue by month"
          description="Jobs completed, by the month they were finished"
        />
        <div className="p-4 pt-0">
          <TrendChart
            label="Revenue"
            points={report.monthly.map((point) => ({ month: point.month, value: point.revenueCents }))}
            formatValue={(value) => formatCentsCompact(value, currency)}
          />
        </div>

        {/*
          The table is not a fallback — it is the guarantee. Every value in the
          chart above is reachable here by a screen reader, in a printout, and by
          anyone the colours do not work for.
        */}
        <details className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <summary className="cursor-pointer text-sm text-slate-600 dark:text-slate-400">
            Show the numbers
          </summary>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Revenue, completed jobs and leads by month</caption>
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th scope="col" className="py-1 pr-4 font-medium">Month</th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">Revenue</th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">Jobs done</th>
                  <th scope="col" className="py-1 text-right font-medium">Leads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.monthly.map((point) => (
                  <tr key={point.month}>
                    <th scope="row" className="py-1.5 pr-4 text-left font-normal text-slate-700 dark:text-slate-300">
                      {formatMonthLabel(point.month)}
                    </th>
                    <td className="tabular py-1.5 pr-4 text-right text-slate-900 dark:text-slate-100">
                      {formatCents(point.revenueCents, currency)}
                    </td>
                    <td className="tabular py-1.5 pr-4 text-right text-slate-600 dark:text-slate-400">
                      {point.jobsCompleted}
                    </td>
                    <td className="tabular py-1.5 text-right text-slate-600 dark:text-slate-400">
                      {point.leads}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Lead to job"
            description="How far enquiries get, cumulatively — a completed job still counts as quoted"
          />
          <div className="p-4 pt-0">
            <FunnelChart stages={report.funnel} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Where the money comes from"
            description="Revenue by the source of the lead that started it"
          />
          <div className="p-4 pt-0">
            <BarList
              emptyMessage="No completed work traceable to a lead source yet."
              rows={report.sources.map((row) => ({
                key: row.source,
                label: row.label,
                value: row.revenueCents,
                display: formatCentsCompact(row.revenueCents, currency),
                secondary: `${row.leads} ${row.leads === 1 ? 'lead' : 'leads'} · ${row.winRatePercent}% won`,
              }))}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Services that earn" description="Completed work by service" />
          <div className="p-4 pt-0">
            <BarList
              emptyMessage="No completed jobs yet."
              rows={report.services.map((row) => ({
                key: row.name,
                label: row.name,
                value: row.revenueCents,
                display: formatCentsCompact(row.revenueCents, currency),
                secondary: `${row.jobs} ${row.jobs === 1 ? 'job' : 'jobs'} · ${formatCentsCompact(row.averageCents, currency)} avg`,
              }))}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Best customers" description="By what they have spent with you" />
          {report.topCustomers.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-500 dark:text-slate-400">
              Complete a job and the customer appears here.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.topCustomers.map((customer) => (
                <li key={customer.id}>
                  <Link
                    href={`/customers/${customer.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-900 dark:text-slate-100">
                        {customer.name}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {customer.jobsCompleted} {customer.jobsCompleted === 1 ? 'job' : 'jobs'}
                      </span>
                    </span>
                    <span className="tabular text-sm font-medium text-slate-900 dark:text-slate-100">
                      {formatCents(customer.lifetimeValueCents, currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="How fast you answer"
          description="The product's whole argument: a homeowner rings three companies and hires whoever answers"
        />
        <dl className="grid gap-4 p-4 pt-0 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-slate-500 dark:text-slate-400">Lead to quote sent</dt>
            <dd className="tabular text-lg font-semibold text-slate-900 dark:text-slate-50">
              {formatHours(report.speed.medianHoursToQuote)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500 dark:text-slate-400">Quote to answer</dt>
            <dd className="tabular text-lg font-semibold text-slate-900 dark:text-slate-50">
              {formatHours(report.speed.medianHoursToResponse)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500 dark:text-slate-400">Quotes measured</dt>
            <dd className="tabular text-lg font-semibold text-slate-900 dark:text-slate-50">
              {report.speed.quotesMeasured}
            </dd>
          </div>
        </dl>
        <p className="px-4 pb-4 text-xs text-slate-500 dark:text-slate-400">
          Medians, not averages — one quote that sat unanswered for three months would drag an
          average past the point of being useful.
        </p>
      </Card>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        {formatMonthShort(report.monthly[0]?.month ?? '')} onwards · figures cover{' '}
        {RANGES[key].label.toLowerCase()} except the revenue trend, which always shows 12 months.
      </p>
    </div>
  );
}
