import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/ui/StatCard';
import { requireAuth } from '@/lib/auth/context';
import { getDashboardSummary } from '@/lib/analytics/summary';
import { formatTimeLabel } from '@/lib/dates';
import { loadTodayAgenda } from '@/lib/scheduling/repository';
import { formatCentsCompact } from '@/lib/money';

export const metadata: Metadata = { title: 'Dashboard' };

// Every figure is per-tenant and changes the moment a lead arrives; a cached
// render would show an owner someone else's snapshot of their own business.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const auth = await requireAuth();
  // Both in one burst: the agenda is the first thing an owner looks at in the
  // morning, and making them wait for the analytics to finish first is backwards.
  const [summary, agenda] = await Promise.all([
    getDashboardSummary(auth.db),
    loadTodayAgenda(auth.db, auth.organization.timezone),
  ]);

  const currency = auth.organization.currency;
  const firstName = auth.user.name?.split(' ')[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {firstName ? `Good to see you, ${firstName}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Where every customer is, right now.
          </p>
        </div>

        <Link href="/leads/new">
          <Button size="sm">New lead</Button>
        </Link>
      </div>

      {auth.organization.onboardedAt === null ? (
        <Alert tone="info" title="Four questions and you are set up">
          <p>
            Your trade, your timezone, what you charge, and where customers leave reviews. Nothing
            here is permanent — it all lives in Settings afterwards.
          </p>
          <Link href="/onboarding" className="mt-2 inline-block">
            <Button size="sm">Set up my workspace</Button>
          </Link>
        </Alert>
      ) : null}

      <section aria-label="This month at a glance">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="Total leads"
            value={String(summary.leads.total)}
            hint="this month"
            deltaPercent={summary.leads.deltaPercent}
            href="/leads"
          />
          <StatCard
            label="New leads"
            value={String(summary.leads.new)}
            hint="awaiting contact"
            href="/leads"
          />
          <StatCard
            label="Qualified"
            value={String(summary.leads.qualified)}
            hint="ready to quote"
            href="/leads"
          />
          <StatCard
            label="Quotes sent"
            value={String(summary.quotes.sent)}
            deltaPercent={summary.quotes.deltaPercent}
          />
          <StatCard
            label="Quotes accepted"
            value={String(summary.quotes.accepted)}
            hint={`${summary.quotes.acceptanceRatePercent}% acceptance`}
          />
          <StatCard label="Jobs scheduled" value={String(summary.jobs.scheduled)} />
          <StatCard
            label="Jobs completed"
            value={String(summary.jobs.completed)}
            deltaPercent={summary.jobs.deltaPercent}
          />
          <StatCard
            label="Revenue"
            value={formatCentsCompact(summary.revenue.completedCents, currency)}
            hint="completed this month"
            deltaPercent={summary.revenue.deltaPercent}
          />
          <StatCard
            label="Outstanding quotes"
            value={formatCentsCompact(summary.quotes.outstandingCents, currency)}
            hint={`${summary.quotes.outstandingCount} awaiting a decision`}
          />
          <StatCard
            label="Conversion rate"
            value={`${summary.conversionRatePercent}%`}
            hint="lead to customer"
          />
        </div>
      </section>

      {agenda.length > 0 ? (
        <Card>
          <CardHeader
            title="Today"
            description={`${agenda.length === 1 ? 'One visit' : `${agenda.length} visits`} booked in`}
            action={
              <Link href="/calendar" className="text-brand-700 dark:text-brand-400 text-sm font-medium">
                Calendar
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {agenda.map((visit) => (
              <li key={visit.id}>
                <Link
                  href={visit.job ? `/jobs/${visit.job.id}` : '/calendar'}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {visit.title}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {visit.customer
                        ? `${visit.customer.firstName} ${visit.customer.lastName ?? ''}`
                        : 'No customer attached'}
                      {visit.addressLine1 ? ` · ${visit.addressLine1}` : ''}
                    </span>
                  </span>
                  <span className="tabular text-sm whitespace-nowrap text-slate-600 dark:text-slate-300">
                    {formatTimeLabel(visit.startsAt, auth.organization.timezone)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent leads"
            description="Newest first"
            action={
              <Link href="/leads" className="text-brand-700 dark:text-brand-400 text-sm font-medium">
                View all
              </Link>
            }
          />
          {summary.recentLeads.length === 0 ? (
            <EmptyState
              title="No leads yet"
              description="They will appear here the moment someone fills in your intake form or you add one by hand."
              action={
                <Link href="/leads/new">
                  <Button size="sm" variant="secondary">
                    Add a lead
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {summary.recentLeads.map((lead) => (
                <li key={lead.id}>
                  <Link
                    href={`/leads/${lead.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {lead.name}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {lead.serviceRequested ?? 'Service not specified'}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-sm text-slate-500 dark:text-slate-400">
                      {lead.estimatedValueCents === null
                        ? '—'
                        : formatCentsCompact(lead.estimatedValueCents, currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Upcoming jobs" description="Next seven days" />
          {summary.upcomingJobs.length === 0 ? (
            <EmptyState
              title="Nothing booked yet"
              description="Accepted quotes turn into jobs automatically and land here."
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {summary.upcomingJobs.map((job) => (
                <li key={job.id}>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {job.title}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {job.customerName}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-sm text-slate-500 dark:text-slate-400">
                      {formatCentsCompact(job.priceCents, currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
