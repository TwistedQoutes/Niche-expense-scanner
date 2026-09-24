import type { Metadata } from 'next';
import Link from 'next/link';
import { QuoteStatus } from '@prisma/client';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAuth } from '@/lib/auth/context';
import { formatRelative } from '@/lib/dates';
import { formatCentsCompact } from '@/lib/money';
import { QUOTE_ROW_SELECT, effectiveStatus } from '@/lib/quotes/repository';

export const metadata: Metadata = { title: 'Quotes' };
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

const LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  VIEWED: 'Viewed',
  CHANGES_REQUESTED: 'Changes asked',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
};

export default async function QuotesPage() {
  const auth = await requireAuth();
  const currency = auth.organization.currency;

  const quotes = await auth.db.quote.findMany({
    select: { ...QUOTE_ROW_SELECT, customer: { select: { firstName: true, lastName: true } } },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
  });

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Quotes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every price you have put in front of a customer.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
        {quotes.length === 0 ? (
          <EmptyState
            title="No quotes yet"
            description="Price a job from a lead, or work one out in the calculator on the Pricing screen first."
            action={
              <Link href="/leads" className="text-brand-700 dark:text-brand-400 text-sm font-medium">
                Go to the pipeline
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-slate-100 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Quote</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Activity</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {quotes.map((quote) => {
                  const status = effectiveStatus(quote);

                  return (
                    <tr key={quote.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-3">
                        <Link
                          href={`/quotes/${quote.id}`}
                          className="tabular font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {quote.number}
                        </Link>
                        {quote.title ? (
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {quote.title}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {quote.customer
                          ? [quote.customer.firstName, quote.customer.lastName]
                              .filter(Boolean)
                              .join(' ')
                          : '—'}
                      </td>

                      <td className="px-4 py-3">
                        <Badge tone={TONES[status]}>{LABELS[status]}</Badge>
                      </td>

                      <td className="tabular px-4 py-3 text-right font-medium text-slate-800 dark:text-slate-200">
                        {formatCentsCompact(quote.totalCents, currency)}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        {quote.respondedAt
                          ? `Answered ${formatRelative(quote.respondedAt)}`
                          : quote.firstViewedAt
                            ? `Viewed ${formatRelative(quote.firstViewedAt)}`
                            : quote.sentAt
                              ? `Sent ${formatRelative(quote.sentAt)}`
                              : `Drafted ${formatRelative(quote.createdAt)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
