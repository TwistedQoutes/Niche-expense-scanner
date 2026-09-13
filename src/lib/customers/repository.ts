import { JobStatus, Prisma, QuoteStatus } from '@prisma/client';

import { notFound } from '@/lib/api/errors';
import type { TenantClient } from '@/lib/db/tenant';

/** Enough for a row in the customer list. */
export const CUSTOMER_ROW_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  company: true,
  city: true,
  state: true,
  tags: true,
  lifetimeValueCents: true,
  jobsCompleted: true,
  lastServicedAt: true,
  nextServiceDueAt: true,
  createdAt: true,
} satisfies Prisma.CustomerSelect;

export type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_ROW_SELECT }>;

/** A list row with its time-relative flag already resolved. */
export type CustomerListRow = CustomerRow & { serviceDueNow: boolean };

/**
 * The customer list.
 *
 * "Is their next service due?" is answered here, not in the component. Reading
 * the clock during render is impure — React's purity rule flags it, correctly —
 * and "due as of when" belongs to the data load rather than to whichever
 * re-render happens to run next.
 */
export async function listCustomerRows(
  db: TenantClient,
  options: { take?: number; now?: Date } = {},
): Promise<CustomerListRow[]> {
  const now = options.now ?? new Date();

  const rows = await db.customer.findMany({
    select: CUSTOMER_ROW_SELECT,
    orderBy: [{ createdAt: 'desc' }],
    take: options.take ?? 100,
  });

  return rows.map((row) => ({
    ...row,
    serviceDueNow:
      row.nextServiceDueAt !== null && row.nextServiceDueAt.getTime() <= now.getTime(),
  }));
}

/**
 * Everything the customer page shows, in one round trip.
 *
 * The spec for this screen is "contact information, property, lead history,
 * quotes, jobs, appointments, messages, revenue, notes, last service, next
 * recommended service" — nine relations. Fetched sequentially that is nine
 * waterfalled queries; issued together it is one burst, which is the difference
 * between a page that opens and a page someone waits for while standing in a
 * customer's driveway.
 */
export async function getCustomerDetail(db: TenantClient, id: string) {
  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      properties: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          label: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
          lawnAreaSqFt: true,
          measurementSource: true,
        },
      },
      leads: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          status: true,
          source: true,
          serviceRequested: true,
          estimatedValueCents: true,
          createdAt: true,
        },
      },
      quotes: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          totalCents: true,
          sentAt: true,
          expiresAt: true,
          createdAt: true,
        },
      },
      jobs: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          priceCents: true,
          scheduledFor: true,
          completedAt: true,
        },
      },
      appointments: {
        orderBy: { startsAt: 'desc' },
        take: 20,
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
          estimatedRevenueCents: true,
        },
      },
      conversations: {
        orderBy: { lastMessageAt: 'desc' },
        take: 10,
        select: {
          id: true,
          channel: true,
          contact: true,
          subject: true,
          lastMessageAt: true,
          unreadCount: true,
        },
      },
    },
  });

  if (!customer) throw notFound('That customer does not exist.');
  return customer;
}

/**
 * Recomputes a customer's rollups from their jobs.
 *
 * `lifetimeValueCents`, `jobsCompleted` and `lastServicedAt` are denormalised
 * onto Customer so the list can render without an aggregate per row. That means
 * they can drift, so they are rebuilt from the jobs themselves rather than
 * incremented — an increment that runs twice, or not at all, is a number nobody
 * can explain later.
 *
 * Called when a job completes or is un-completed.
 */
export async function refreshCustomerTotals(db: TenantClient, customerId: string): Promise<void> {
  const completed = await db.job.aggregate({
    where: { customerId, status: JobStatus.COMPLETED },
    _sum: { priceCents: true },
    _count: true,
    _max: { completedAt: true },
  });

  await db.customer.update({
    where: { id: customerId },
    data: {
      lifetimeValueCents: completed._sum.priceCents ?? 0,
      jobsCompleted: completed._count,
      lastServicedAt: completed._max.completedAt,
    },
  });
}

/** Outstanding money and open work, for the header on the customer page. */
export async function getCustomerSummary(db: TenantClient, customerId: string) {
  const [outstanding, openJobs] = await Promise.all([
    db.quote.aggregate({
      where: {
        customerId,
        status: { in: [QuoteStatus.SENT, QuoteStatus.VIEWED, QuoteStatus.CHANGES_REQUESTED] },
      },
      _sum: { totalCents: true },
      _count: true,
    }),
    db.job.count({
      where: {
        customerId,
        status: { in: [JobStatus.SCHEDULED, JobStatus.CONFIRMED, JobStatus.IN_PROGRESS] },
      },
    }),
  ]);

  return {
    outstandingQuoteCents: outstanding._sum.totalCents ?? 0,
    outstandingQuoteCount: outstanding._count,
    openJobs,
  };
}
