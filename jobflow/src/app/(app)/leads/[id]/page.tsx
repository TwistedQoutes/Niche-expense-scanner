import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { LeadActions } from '@/components/leads/LeadActions';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { AppError } from '@/lib/api/errors';
import { requireAuth } from '@/lib/auth/context';
import { formatDateTimeLabel, formatRelative } from '@/lib/dates';
import { columnFor } from '@/lib/leads/pipeline';
import { getLead } from '@/lib/leads/repository';
import { formatCents } from '@/lib/money';

export const metadata: Metadata = { title: 'Lead' };
export const dynamic = 'force-dynamic';

export default async function LeadPage(props: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await props.params;

  let lead;
  try {
    lead = await getLead(auth.db, id);
  } catch (error) {
    // The repository throws a 404-shaped AppError; on a page that has to become
    // Next's own not-found, or the error boundary shows a 500 for a missing row.
    if (error instanceof AppError && error.code === 'not_found') notFound();
    throw error;
  }

  const column = columnFor(lead.status);
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ');
  const currency = auth.organization.currency;
  const timeZone = auth.organization.timezone;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <div>
        <Link
          href="/leads"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Back to the pipeline
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">{name}</h1>
          <Badge tone={column.tone}>{column.label}</Badge>
          {lead.aiScore !== null ? <Badge tone="neutral">Score {lead.aiScore}</Badge> : null}
        </div>

        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Added {formatRelative(lead.createdAt)}
          {lead.serviceRequested ? ` · ${lead.serviceRequested}` : ''}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
              <Detail label="Phone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
              <Detail
                label="Email"
                value={lead.email}
                href={lead.email ? `mailto:${lead.email}` : undefined}
              />
              <Detail
                label="Address"
                value={[lead.addressLine1, lead.city, lead.state, lead.postalCode]
                  .filter(Boolean)
                  .join(', ')}
              />
              <Detail label="Source" value={lead.source} />
              <Detail
                label="Estimated value"
                value={
                  lead.estimatedValueCents === null
                    ? null
                    : formatCents(lead.estimatedValueCents, currency)
                }
              />
              <Detail
                label="Next follow-up"
                value={
                  lead.nextFollowUpAt ? formatDateTimeLabel(lead.nextFollowUpAt, timeZone) : null
                }
              />
            </dl>

            {lead.description ? (
              <div className="border-t border-slate-100 p-4 dark:border-slate-800">
                <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                  {lead.description}
                </p>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Activity" description="Newest first" />
            {lead.activities.length === 0 ? (
              <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
                Nothing has happened yet.
              </p>
            ) : (
              <ol className="divide-y divide-slate-100 dark:divide-slate-800">
                {lead.activities.map((activity) => (
                  <li key={activity.id} className="px-4 py-3">
                    <p className="text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                      {activity.summary}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {formatRelative(activity.createdAt)}
                      {activity.actorUserId === null ? ' · automatic' : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Actions" />
            <div className="p-4">
              <LeadActions
                leadId={lead.id}
                status={lead.status}
                converted={lead.customerId !== null}
              />
            </div>
          </Card>

          {lead.customer ? (
            <Card>
              <CardHeader title="Customer" />
              <div className="p-4">
                <Link
                  href={`/customers/${lead.customer.id}`}
                  className="text-brand-700 dark:text-brand-400 text-sm font-medium hover:underline"
                >
                  {[lead.customer.firstName, lead.customer.lastName].filter(Boolean).join(' ')}
                </Link>
              </div>
            </Card>
          ) : null}

          {lead.quotes.length > 0 ? (
            <Card>
              <CardHeader title="Quotes" />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {lead.quotes.map((quote) => (
                  <li key={quote.id} className="flex items-center justify-between gap-2 px-4 py-3">
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      {quote.number}
                    </span>
                    <span className="tabular text-sm text-slate-500 dark:text-slate-400">
                      {formatCents(quote.totalCents, currency)}
                    </span>
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

function Detail({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null;
  href?: string;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
        {value ? (
          href ? (
            // Tappable on a phone, which is where this page gets used.
            <a href={href} className="text-brand-700 dark:text-brand-400 hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-slate-400 dark:text-slate-500">—</span>
        )}
      </dd>
    </div>
  );
}
