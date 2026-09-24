import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { AppError } from '@/lib/api/errors';
import { requireAuth } from '@/lib/auth/context';
import { getCustomerDetail, getCustomerSummary } from '@/lib/customers/repository';
import { formatDateTimeLabel, formatRelative } from '@/lib/dates';
import { columnFor } from '@/lib/leads/pipeline';
import { formatCents, formatCentsCompact } from '@/lib/money';

export const metadata: Metadata = { title: 'Customer' };
export const dynamic = 'force-dynamic';

export default async function CustomerPage(props: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await props.params;

  let customer;
  let summary;
  try {
    [customer, summary] = await Promise.all([
      getCustomerDetail(auth.db, id),
      getCustomerSummary(auth.db, id),
    ]);
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') notFound();
    throw error;
  }

  const currency = auth.organization.currency;
  const timeZone = auth.organization.timezone;
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ');

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <div>
        <Link
          href="/customers"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Back to customers
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{name}</h1>
          {customer.tags.map((tag) => (
            <Badge key={tag} tone="neutral">
              {tag}
            </Badge>
          ))}
        </div>

        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {[customer.company, customer.phone, customer.email].filter(Boolean).join(' · ') ||
            'No contact details yet'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Lifetime value"
          value={formatCentsCompact(customer.lifetimeValueCents, currency)}
          hint="completed jobs"
        />
        <StatCard label="Jobs completed" value={String(customer.jobsCompleted)} />
        <StatCard
          label="Outstanding quotes"
          value={formatCentsCompact(summary.outstandingQuoteCents, currency)}
          hint={`${summary.outstandingQuoteCount} awaiting a decision`}
        />
        <StatCard label="Open jobs" value={String(summary.openJobs)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Service history" />
          <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
            <Detail
              label="Last service"
              value={customer.lastServicedAt ? formatRelative(customer.lastServicedAt) : null}
            />
            <Detail
              label="Next recommended"
              value={
                customer.nextServiceDueAt
                  ? formatDateTimeLabel(customer.nextServiceDueAt, timeZone)
                  : null
              }
            />
            <Detail
              label="Address"
              value={[customer.addressLine1, customer.city, customer.state, customer.postalCode]
                .filter(Boolean)
                .join(', ')}
            />
            <Detail label="Customer since" value={formatRelative(customer.createdAt)} />
          </dl>

          {customer.notes ? (
            <div className="border-t border-slate-100 p-4 dark:border-slate-800">
              <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {customer.notes}
              </p>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Properties" description="Where the work happens" />
          {customer.properties.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              No property recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {customer.properties.map((property) => (
                <li key={property.id} className="px-4 py-3">
                  <p className="text-sm text-slate-800 dark:text-slate-200">
                    {[property.addressLine1, property.city, property.state, property.postalCode]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                  {property.lawnAreaSqFt ? (
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {property.lawnAreaSqFt.toLocaleString()} sq ft
                      {/*
                        Labelled every time it is shown. A measurement that was
                        not taken by hand is an estimate, and a quote built on a
                        guess presented as a fact loses money on the job.
                      */}
                      {property.measurementSource === 'manual' ? '' : ' (estimated)'}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Lead history" description="How they found you" />
          {customer.leads.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No leads on record.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {customer.leads.map((lead) => (
                <li key={lead.id}>
                  <Link
                    href={`/leads/${lead.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-800 dark:text-slate-200">
                        {lead.serviceRequested ?? 'Service not specified'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {lead.source} · {formatRelative(lead.createdAt)}
                      </p>
                    </div>
                    <Badge tone={columnFor(lead.status).tone}>
                      {columnFor(lead.status).label}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Quotes" />
          {customer.quotes.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No quotes yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {customer.quotes.map((quote) => (
                <li key={quote.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-800 dark:text-slate-200">
                      {quote.title ?? quote.number}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{quote.status}</p>
                  </div>
                  <span className="tabular text-sm text-slate-700 dark:text-slate-300">
                    {formatCents(quote.totalCents, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Jobs" />
          {customer.jobs.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No jobs yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {customer.jobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-800 dark:text-slate-200">
                      {job.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {job.scheduledFor ? formatDateTimeLabel(job.scheduledFor, timeZone) : job.status}
                    </p>
                  </div>
                  <span className="tabular text-sm text-slate-700 dark:text-slate-300">
                    {formatCents(job.priceCents, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Conversations" />
          {customer.conversations.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              Nothing sent or received yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {customer.conversations.map((conversation) => (
                <li
                  key={conversation.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-800 dark:text-slate-200">
                      {conversation.subject ?? conversation.contact}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {conversation.channel}
                      {conversation.lastMessageAt
                        ? ` · ${formatRelative(conversation.lastMessageAt)}`
                        : ''}
                    </p>
                  </div>
                  {conversation.unreadCount > 0 ? (
                    <Badge tone="urgent">{conversation.unreadCount}</Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
        {value || <span className="text-slate-400 dark:text-slate-500">—</span>}
      </dd>
    </div>
  );
}
