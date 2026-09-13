import { ReviewRequestStatus } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AskForReview } from '@/components/reviews/AskForReview';
import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/ui/StatCard';
import { requireAuth } from '@/lib/auth/context';
import { formatRelative } from '@/lib/dates';
import { prisma } from '@/lib/db/client';
import { formatCentsCompact } from '@/lib/money';
import { findLapsedCustomers, listReviewRequests, reviewStats } from '@/lib/reviews/repository';

export const metadata: Metadata = { title: 'Reviews' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<ReviewRequestStatus, string> = {
  [ReviewRequestStatus.PENDING]: 'Queued',
  [ReviewRequestStatus.SENT]: 'Sent',
  [ReviewRequestStatus.OPENED]: 'Opened',
  [ReviewRequestStatus.CLICKED]: 'Tapped through',
  [ReviewRequestStatus.COMPLETED]: 'Left a review',
  [ReviewRequestStatus.FAILED]: 'Failed',
};

const STATUS_TONE: Record<ReviewRequestStatus, BadgeTone> = {
  [ReviewRequestStatus.PENDING]: 'pending',
  [ReviewRequestStatus.SENT]: 'info',
  [ReviewRequestStatus.OPENED]: 'active',
  [ReviewRequestStatus.CLICKED]: 'success',
  [ReviewRequestStatus.COMPLETED]: 'success',
  [ReviewRequestStatus.FAILED]: 'danger',
};

export default async function ReviewsPage() {
  const auth = await requireAuth();

  const [requests, stats, lapsed, organization] = await Promise.all([
    listReviewRequests(auth.db, { limit: 50 }),
    reviewStats(auth.db),
    findLapsedCustomers(auth.db, { limit: 25 }),
    prisma.organization.findUnique({
      where: { id: auth.organization.id },
      select: { reviewUrl: true },
    }),
  ]);

  const currency = auth.organization.currency;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Reviews</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          The cheapest job to win is one from somebody who has already paid you.
        </p>
      </div>

      {!organization?.reviewUrl ? (
        <Alert tone="warning" title="No review link set">
          <p>
            Review requests are skipped until you add the link customers should leave a review on.{' '}
            <Link href="/settings" className="font-medium underline">
              Add it in Settings
            </Link>
            .
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Requests sent" value={String(stats.sent)} />
        <StatCard
          label="Tapped through"
          value={String(stats.clicked)}
          hint={`${stats.clickRatePercent}% of those sent`}
        />
        <StatCard label="Queued" value={String(stats.pending)} />
        <StatCard label="Due a nudge" value={String(lapsed.length)} hint="lapsed customers" />
      </div>

      <Card>
        <CardHeader
          title="Worth getting back"
          description="Customers who are due again, or have not been seen in a while. Most valuable first."
        />

        {lapsed.length === 0 ? (
          <EmptyState
            title="Nobody is overdue"
            description="Complete a job with a “due again in” and the customer shows up here when that date passes."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {lapsed.map((customer) => (
              <li
                key={customer.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/customers/${customer.id}`}
                    className="block truncate text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
                  >
                    {customer.firstName} {customer.lastName ?? ''}
                  </Link>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {customer.lastServicedAt
                      ? `Last job ${formatRelative(customer.lastServicedAt)}`
                      : 'No completed job on record'}
                    {' · '}
                    {formatCentsCompact(customer.lifetimeValueCents, currency)} lifetime
                    {customer.jobsCompleted > 1 ? ` · ${customer.jobsCompleted} jobs` : ''}
                  </p>
                </div>

                {customer.optedOut ? (
                  <Badge tone="neutral">Opted out of texts</Badge>
                ) : (
                  <AskForReview customerId={customer.id} label="Ask for a review" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Review requests" description="Newest first" />

        {requests.length === 0 ? (
          <EmptyState
            title="No review requests yet"
            description="Completing a job asks for one automatically, if that automation is on."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {requests.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/customers/${request.customer.id}`}
                    className="block truncate text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
                  >
                    {request.customer.firstName} {request.customer.lastName ?? ''}
                  </Link>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {request.job ? `${request.job.number} · ${request.job.title}` : 'Asked by hand'}
                    {' · '}
                    {formatRelative(request.createdAt)}
                  </p>
                </div>

                <Badge tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
