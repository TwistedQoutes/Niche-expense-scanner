import { OrganizationStatus, SubscriptionStatus } from '@prisma/client';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BarList } from '@/components/charts/BarList';
import { TrendChart } from '@/components/charts/TrendChart';
import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { AppError } from '@/lib/api/errors';
import { loadPlatformReport } from '@/lib/analytics/platform';
import { requirePlatformAdmin } from '@/lib/auth/context';
import { formatDateLabel, formatMonthLabel } from '@/lib/dates';
import { formatCents, formatCentsCompact } from '@/lib/money';

export const metadata: Metadata = { title: 'Platform admin' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<OrganizationStatus, BadgeTone> = {
  [OrganizationStatus.ACTIVE]: 'success',
  [OrganizationStatus.SUSPENDED]: 'danger',
};

const SUB_TONE: Record<SubscriptionStatus, BadgeTone> = {
  [SubscriptionStatus.TRIALING]: 'info',
  [SubscriptionStatus.ACTIVE]: 'success',
  [SubscriptionStatus.PAST_DUE]: 'urgent',
  [SubscriptionStatus.UNPAID]: 'urgent',
  [SubscriptionStatus.CANCELED]: 'danger',
  [SubscriptionStatus.INCOMPLETE]: 'pending',
};

/**
 * The operator's view of the whole platform.
 *
 * `requirePlatformAdmin()` is the only door, and it refuses with a not-found
 * shaped message so a signed-in customer probing `/admin` does not even learn the
 * surface exists.
 *
 * What is shown is deliberately limited to aggregates and the operator's own
 * administrative fields: that a workspace exists, what it pays, whether it is
 * active, and how much it has in it. There is no route from here into anybody's
 * leads, customers or messages — running the platform does not require reading
 * its customers' mail.
 */
export default async function AdminPage() {
  /*
   * `requirePlatformAdmin` throws an AppError, which is the right shape for an API
   * route — where `withRoute` turns it into a JSON response — but on a page there
   * is nothing to catch it, and an uncaught throw renders Next's 500. That both
   * looks broken and hints that something is here: a server error is information.
   * So it becomes a real 404, which is what the refusal was trying to say.
   */
  try {
    await requirePlatformAdmin();
  } catch (error) {
    if (error instanceof AppError) notFound();
    throw error;
  }

  const report = await loadPlatformReport();

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Platform admin</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every workspace on this deployment.
        </p>
      </div>

      <Alert tone="info" title="Counts and billing only">
        <p>
          This page shows aggregates and subscription state. It gives no access to any
          business&rsquo;s leads, customers or messages — running the platform does not require
          reading its customers&rsquo; mail.
        </p>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Monthly recurring"
          value={formatCentsCompact(report.totals.mrrCents, 'USD')}
          hint="from list prices"
        />
        <StatCard
          label="Paying workspaces"
          value={String(report.totals.paying)}
          hint={`${report.totals.trialing} on trial`}
        />
        <StatCard
          label="Workspaces"
          value={String(report.totals.organizations)}
          hint={`${report.totals.activeOrganizations} active · ${report.totals.demoOrganizations} demo`}
        />
        <StatCard label="People" value={String(report.totals.users)} hint="user accounts" />
      </div>

      <Card>
        <CardHeader title="Signups by month" description="New workspaces, last 12 months" />
        <div className="p-4 pt-0">
          {/*
            The same trend component as the analytics screen, told how to write its
            values. It takes a formatter precisely so a count is never rendered
            through a currency formatter.
          */}
          <TrendChart
            label="New workspaces"
            points={report.signups.map((point) => ({ month: point.month, value: point.signups }))}
            formatValue={(value) => String(Math.round(value))}
          />
        </div>

        <details className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <summary className="cursor-pointer text-sm text-slate-600 dark:text-slate-400">
            Show the numbers
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">New workspaces by month</caption>
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th scope="col" className="py-1 pr-4 font-medium">Month</th>
                  <th scope="col" className="py-1 text-right font-medium">New workspaces</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.signups.map((point) => (
                  <tr key={point.month}>
                    <th scope="row" className="py-1.5 pr-4 text-left font-normal text-slate-700 dark:text-slate-300">
                      {formatMonthLabel(point.month)}
                    </th>
                    <td className="tabular py-1.5 text-right text-slate-900 dark:text-slate-100">
                      {point.signups}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <Card>
        <CardHeader title="Revenue by plan" description="Where the recurring revenue sits" />
        <div className="p-4 pt-0">
          <BarList
            emptyMessage="Nobody is paying yet."
            rows={report.plans.map((plan) => ({
              key: plan.tier,
              label: plan.name,
              value: plan.mrrCents,
              display: formatCentsCompact(plan.mrrCents, 'USD'),
              secondary: `${plan.paying} paying of ${plan.workspaces}`,
            }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Workspaces"
          description="Newest first, up to a hundred"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Every workspace, with its plan and activity</caption>
            <thead className="border-b border-slate-100 dark:border-slate-800">
              <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                <th scope="col" className="px-4 py-2 font-medium">Business</th>
                <th scope="col" className="px-4 py-2 font-medium">Plan</th>
                <th scope="col" className="px-4 py-2 font-medium">Billing</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">People</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Leads</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Jobs</th>
                <th scope="col" className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    <span className="block truncate text-slate-900 dark:text-slate-100">
                      {workspace.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      {workspace.industry.replace(/_/g, ' ')}
                      {workspace.isDemo ? <Badge tone="neutral">demo</Badge> : null}
                      {workspace.status !== OrganizationStatus.ACTIVE ? (
                        <Badge tone={STATUS_TONE[workspace.status]}>
                          {workspace.status.toLowerCase()}
                        </Badge>
                      ) : null}
                    </span>
                  </th>

                  <td className="px-4 py-2">
                    <span className="text-slate-700 dark:text-slate-300">{workspace.plan}</span>
                    {workspace.effective !== workspace.plan ? (
                      <span className="block text-xs text-amber-700 dark:text-amber-500">
                        on {workspace.effective} limits
                      </span>
                    ) : null}
                  </td>

                  <td className="px-4 py-2">
                    {workspace.subscriptionStatus ? (
                      <Badge tone={SUB_TONE[workspace.subscriptionStatus]}>
                        {workspace.subscriptionStatus.toLowerCase().replace('_', ' ')}
                      </Badge>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">none</span>
                    )}
                  </td>

                  <td className="tabular px-4 py-2 text-right text-slate-600 dark:text-slate-400">
                    {workspace.members}
                  </td>
                  <td className="tabular px-4 py-2 text-right text-slate-600 dark:text-slate-400">
                    {workspace.leads}
                  </td>
                  <td className="tabular px-4 py-2 text-right text-slate-600 dark:text-slate-400">
                    {workspace.jobs}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {formatDateLabel(workspace.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Plan list prices" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Plan prices and how many workspaces are on each</caption>
            <thead className="border-b border-slate-100 dark:border-slate-800">
              <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                <th scope="col" className="px-4 py-2 font-medium">Plan</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Price</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Workspaces</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Paying</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">MRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.plans.map((plan) => (
                <tr key={plan.tier}>
                  <th scope="row" className="px-4 py-2 text-left font-normal text-slate-900 dark:text-slate-100">
                    {plan.name}
                  </th>
                  <td className="tabular px-4 py-2 text-right text-slate-600 dark:text-slate-400">
                    {plan.monthlyPriceCents === 0
                      ? '—'
                      : `${formatCents(plan.monthlyPriceCents, 'USD')}/mo`}
                  </td>
                  <td className="tabular px-4 py-2 text-right text-slate-600 dark:text-slate-400">
                    {plan.workspaces}
                  </td>
                  <td className="tabular px-4 py-2 text-right text-slate-600 dark:text-slate-400">
                    {plan.paying}
                  </td>
                  <td className="tabular px-4 py-2 text-right text-slate-900 dark:text-slate-100">
                    {formatCents(plan.mrrCents, 'USD')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
          MRR is computed from list prices, so discounts and promotion codes are not reflected.
          Stripe is the authority on money; this is a health indicator.
        </p>
      </Card>
    </div>
  );
}
