import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { QuoteStatus } from '@prisma/client';

import { SendQuote } from '@/components/quotes/SendQuote';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { AppError } from '@/lib/api/errors';
import { requireAuth } from '@/lib/auth/context';
import { formatDateTimeLabel, formatRelative } from '@/lib/dates';
import { getPublicConfig } from '@/lib/env';
import { formatBps, formatCents } from '@/lib/money';
import { effectiveStatus, getQuoteByIdOrPublicId } from '@/lib/quotes/repository';

export const metadata: Metadata = { title: 'Quote' };
export const dynamic = 'force-dynamic';

const TONES: Record<QuoteStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SENT: 'pending',
  VIEWED: 'info',
  CHANGES_REQUESTED: 'urgent',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'neutral',
};

export default async function QuotePage(props: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await props.params;

  let quote;
  try {
    quote = await getQuoteByIdOrPublicId(auth.db, { id });
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') notFound();
    throw error;
  }

  const status = effectiveStatus(quote);
  const currency = quote.currency || auth.organization.currency;
  const timeZone = auth.organization.timezone;
  const publicUrl = `${getPublicConfig().appUrl.replace(/\/+$/, '')}/quote/${quote.publicId}`;

  // Recomputed rather than stored: the margin a quote actually earns is a
  // function of two frozen numbers, so deriving it cannot drift from them.
  const profitCents = quote.subtotalCents - quote.estimatedCostCents;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <div>
        <Link
          href="/quotes"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Back to quotes
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="tabular text-xl font-semibold text-slate-900 dark:text-slate-50">
            {quote.number}
          </h1>
          <Badge tone={TONES[status]}>{status.replace('_', ' ').toLowerCase()}</Badge>
          {quote.priceOverridden ? <Badge tone="info">Price set by hand</Badge> : null}
        </div>

        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {quote.title ?? 'Untitled'}
          {quote.customer
            ? ` · ${[quote.customer.firstName, quote.customer.lastName].filter(Boolean).join(' ')}`
            : ''}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Line items" />
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {quote.items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800 dark:text-slate-200">
                      {item.name}
                      {item.optional ? (
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                          optional
                        </span>
                      ) : null}
                    </p>
                    {item.description ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                  <span className="tabular shrink-0 text-sm text-slate-800 dark:text-slate-200">
                    {formatCents(item.totalCents, currency)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
              <div className="flex justify-between">
                <dt className="text-slate-600 dark:text-slate-400">Subtotal</dt>
                <dd className="tabular text-slate-800 dark:text-slate-200">
                  {formatCents(quote.subtotalCents, currency)}
                </dd>
              </div>
              {quote.taxCents > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">Tax</dt>
                  <dd className="tabular text-slate-800 dark:text-slate-200">
                    {formatCents(quote.taxCents, currency)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-slate-100 pt-1.5 dark:border-slate-800">
                <dt className="font-semibold text-slate-900 dark:text-slate-50">Total</dt>
                <dd className="tabular font-semibold text-slate-900 dark:text-slate-50">
                  {formatCents(quote.totalCents, currency)}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Your numbers"
              description="Frozen when this quote was created — not affected by later rate changes"
            />
            <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-3">
              <Figure label="Estimated cost" value={formatCents(quote.estimatedCostCents, currency)} />
              <Figure label="Profit" value={formatCents(profitCents, currency)} />
              <Figure label="Target margin" value={formatBps(quote.profitMarginBps)} />
              <Figure label="Labour" value={formatCents(quote.laborCostCents, currency)} />
              <Figure label="Materials" value={formatCents(quote.materialCostCents, currency)} />
              <Figure label="Travel" value={formatCents(quote.travelCostCents, currency)} />
            </dl>
          </Card>

          {quote.customerNote ? (
            <Card>
              <CardHeader title="What the customer said" />
              <p className="p-4 text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {quote.customerNote}
              </p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Delivery" />
            <div className="p-4">
              <SendQuote
                quoteId={quote.id}
                isDraft={quote.status === QuoteStatus.DRAFT}
                publicUrl={publicUrl}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="History" />
            <dl className="space-y-3 p-4">
              <Figure
                label="Sent"
                value={quote.sentAt ? formatDateTimeLabel(quote.sentAt, timeZone) : '—'}
              />
              <Figure
                label="First opened"
                value={
                  quote.firstViewedAt
                    ? `${formatRelative(quote.firstViewedAt)} (${quote.viewCount} view${quote.viewCount === 1 ? '' : 's'})`
                    : 'Not yet'
                }
              />
              <Figure
                label="Answered"
                value={quote.respondedAt ? formatRelative(quote.respondedAt) : '—'}
              />
              <Figure
                label="Expires"
                value={quote.expiresAt ? formatDateTimeLabel(quote.expiresAt, timeZone) : '—'}
              />
            </dl>
          </Card>

          {quote.jobs.length > 0 ? (
            <Card>
              <CardHeader title="Job" description="Created when the customer accepted" />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {quote.jobs.map((job) => (
                  <li key={job.id} className="px-4 py-3">
                    <p className="tabular text-sm font-medium text-slate-900 dark:text-slate-100">
                      {job.number}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{job.status}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {quote.leadId ? (
            <Card>
              <CardHeader title="Lead" />
              <div className="p-4">
                <Link
                  href={`/leads/${quote.leadId}`}
                  className="text-brand-700 dark:text-brand-400 text-sm font-medium hover:underline"
                >
                  View the lead
                </Link>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="tabular mt-0.5 text-sm text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  );
}
