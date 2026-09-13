import { AutomationTrigger, Channel, Prisma, ReviewRequestStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { conflict, notFound } from '@/lib/api/errors';
import { fireTrigger } from '@/lib/automations/trigger';
import { addDays } from '@/lib/dates';
import { prisma } from '@/lib/db/client';
import { assertOwned } from '@/lib/db/ownership';
import { forOrganization, type TenantClient } from '@/lib/db/tenant';
import { hasOptedOut } from '@/lib/messaging/optout';

/**
 * Reviews, and bringing lapsed customers back.
 *
 * Both are the same business argument from different ends: the cheapest job to
 * win is one from somebody who has already paid you. Reviews win the next
 * stranger; reactivation wins the same person again.
 */

const REVIEW_SELECT = {
  id: true,
  status: true,
  channel: true,
  token: true,
  reviewUrl: true,
  sentAt: true,
  openedAt: true,
  clickedAt: true,
  createdAt: true,
  customer: { select: { id: true, firstName: true, lastName: true, tags: true } },
  job: { select: { id: true, number: true, title: true, completedAt: true } },
} satisfies Prisma.ReviewRequestSelect;

export type ReviewRequestRow = Prisma.ReviewRequestGetPayload<{ select: typeof REVIEW_SELECT }>;

/**
 * The token behind `/r/{token}`.
 *
 * 128 bits of randomness, for the same reason a quote's public id is: the URL is
 * the only thing identifying the request, it arrives in a text message, and a
 * guessable one would let a stranger mark another business's customer as having
 * clicked through.
 */
export function generateReviewToken(): string {
  return randomBytes(16).toString('base64url');
}

export async function listReviewRequests(
  db: TenantClient,
  options: { status?: ReviewRequestStatus; limit?: number } = {},
): Promise<ReviewRequestRow[]> {
  return db.reviewRequest.findMany({
    where: options.status ? { status: options.status } : {},
    select: REVIEW_SELECT,
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
  });
}

export type ReviewStats = {
  sent: number;
  clicked: number;
  pending: number;
  failed: number;
  /** Of the requests that went out, how many were tapped. */
  clickRatePercent: number;
};

export async function reviewStats(db: TenantClient): Promise<ReviewStats> {
  const grouped = await db.reviewRequest.groupBy({ by: ['status'], _count: { _all: true } });

  const counts = Object.fromEntries(
    Object.values(ReviewRequestStatus).map((status) => [status, 0]),
  ) as Record<ReviewRequestStatus, number>;

  for (const row of grouped) counts[row.status] = row._count._all;

  /*
   * A clicked request was also sent — the status moves forward rather than
   * accumulating — so "how many went out" is the sum of every status past
   * PENDING, and counting only SENT would make the rate look impossible.
   */
  const delivered =
    counts.SENT + counts.OPENED + counts.CLICKED + counts.COMPLETED;
  const clicked = counts.CLICKED + counts.COMPLETED;

  return {
    sent: delivered,
    clicked,
    pending: counts.PENDING,
    failed: counts.FAILED,
    clickRatePercent: delivered === 0 ? 0 : Math.round((clicked / delivered) * 100),
  };
}

/**
 * Records that a customer tapped the link, and says where to send them.
 *
 * Deliberately **not** tenant-scoped: the person following the link has no
 * session, and the token is what identifies the request — and through it, the one
 * organization it belongs to. Same argument as the public quote page: looking a
 * row up by a 128-bit secret *identifies* a tenant rather than letting the caller
 * choose one.
 */
export async function recordReviewClick(
  token: string,
): Promise<{ reviewUrl: string | null } | null> {
  const request = await prisma.reviewRequest.findUnique({
    where: { token },
    select: { id: true, reviewUrl: true, status: true, clickedAt: true },
  });

  if (!request) return null;

  /*
   * The first tap is the one recorded. A customer who opens the link twice, or
   * whose mail client prefetches it, has not changed their mind twice — and
   * overwriting clickedAt would lose when they actually engaged.
   */
  if (!request.clickedAt) {
    await prisma.reviewRequest.update({
      where: { id: request.id },
      data: { status: ReviewRequestStatus.CLICKED, clickedAt: new Date() },
    });
  }

  return { reviewUrl: request.reviewUrl };
}

export type SendReviewRequestResult =
  | { ok: true; reviewRequestId: string; token: string }
  | { ok: false; reason: 'no_review_url' | 'opted_out' | 'already_asked'; message: string };

/**
 * Asking one customer for a review, by hand.
 *
 * The automated path is a step in the review automation; this is the owner
 * deciding to ask somebody specific. It refuses the same cases the automation
 * skips, but says why — because an owner who pressed a button deserves an answer,
 * whereas a background sequence quietly moving on is correct.
 */
export async function createReviewRequest(
  db: TenantClient,
  organizationId: string,
  input: { customerId: string; jobId?: string | null },
): Promise<SendReviewRequestResult> {
  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, tags: true },
  });
  if (!customer) throw notFound('That customer does not exist.');

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { reviewUrl: true },
  });

  if (!organization?.reviewUrl) {
    return {
      ok: false,
      reason: 'no_review_url',
      message:
        'Add the link customers should leave a review on, under Settings, and this will start working.',
    };
  }

  if (hasOptedOut(customer.tags)) {
    return {
      ok: false,
      reason: 'opted_out',
      message: 'That customer has opted out of texts, so we will not message them.',
    };
  }

  /*
   * One ask per job. Two review requests for the same visit is the kind of thing
   * that makes a business look automated in the worst way, and the customer
   * cannot leave two reviews anyway.
   */
  if (input.jobId) {
    // Ours first. The duplicate check below is scoped to this tenant, so a job id
    // from another business would find no existing request, sail past it, and be
    // written onto the row — where REVIEW_SELECT reads its number and title back
    // out (src/lib/db/ownership.ts).
    await assertOwned(db, { jobId: input.jobId });

    const existing = await db.reviewRequest.findFirst({
      where: { jobId: input.jobId },
      select: { id: true },
    });

    if (existing) {
      return {
        ok: false,
        reason: 'already_asked',
        message: 'A review has already been requested for that job.',
      };
    }
  }

  const token = generateReviewToken();

  const created = await db.reviewRequest.create({
    data: {
      organizationId,
      customerId: customer.id,
      jobId: input.jobId ?? null,
      channel: Channel.SMS,
      status: ReviewRequestStatus.PENDING,
      token,
      reviewUrl: organization.reviewUrl,
    },
    select: { id: true },
  });

  return { ok: true, reviewRequestId: created.id, token };
}

/** How long without work before a customer is worth chasing. */
export const DEFAULT_INACTIVE_DAYS = 60;

export type LapsedCustomer = {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  lastServicedAt: Date | null;
  nextServiceDueAt: Date | null;
  lifetimeValueCents: number;
  jobsCompleted: number;
  optedOut: boolean;
};

/**
 * Customers worth a nudge.
 *
 * Two different reasons to appear here, and the distinction matters:
 *
 *  - **Due.** A job was completed with "due again in N days", so there is a real
 *    date and it has passed. This is the strong signal — the owner said so.
 *  - **Lapsed.** No due date was ever set, and the last visit is further back
 *    than the threshold. Weaker, but it is most of a real customer list.
 *
 * Someone who has never had a completed job is not lapsed, they are simply new,
 * and chasing them as a former customer would read as a mistake.
 */
export async function findLapsedCustomers(
  db: TenantClient,
  options: { inactiveDays?: number; limit?: number; now?: Date } = {},
): Promise<LapsedCustomer[]> {
  const now = options.now ?? new Date();
  const inactiveDays = options.inactiveDays ?? DEFAULT_INACTIVE_DAYS;
  const cutoff = addDays(now, -inactiveDays);

  const rows = await db.customer.findMany({
    where: {
      jobsCompleted: { gt: 0 },
      OR: [
        { nextServiceDueAt: { lte: now } },
        { AND: [{ nextServiceDueAt: null }, { lastServicedAt: { lte: cutoff } }] },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      tags: true,
      lastServicedAt: true,
      nextServiceDueAt: true,
      lifetimeValueCents: true,
      jobsCompleted: true,
    },
    // The most valuable lapsed customer is the one to ring first.
    orderBy: [{ lifetimeValueCents: 'desc' }],
    take: options.limit ?? 100,
  });

  return rows.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    lastServicedAt: row.lastServicedAt,
    nextServiceDueAt: row.nextServiceDueAt,
    lifetimeValueCents: row.lifetimeValueCents,
    jobsCompleted: row.jobsCompleted,
    optedOut: hasOptedOut(row.tags),
  }));
}

export type ReactivationReport = {
  considered: number;
  started: number;
  skippedOptedOut: number;
};

/**
 * Fires the reactivation sequence for everyone who is due.
 *
 * Called from the cron worker, so it must be safe to run every few minutes. Two
 * things make it so:
 *
 *  - `rearmFinishedRuns` only re-arms a sequence that has **finished**, so a chase
 *    in flight is never restarted.
 *  - Firing pushes `nextServiceDueAt` a full window forward. Without that, a
 *    customer whose sequence completed while they were still overdue would be
 *    chased again on the very next pass, forever.
 */
export async function runReactivationSweep(
  db: TenantClient,
  organizationId: string,
  options: { inactiveDays?: number; now?: Date; limit?: number } = {},
): Promise<ReactivationReport> {
  const now = options.now ?? new Date();
  const inactiveDays = options.inactiveDays ?? DEFAULT_INACTIVE_DAYS;

  const candidates = await findLapsedCustomers(db, { ...options, now, inactiveDays });

  const report: ReactivationReport = {
    considered: candidates.length,
    started: 0,
    skippedOptedOut: 0,
  };

  for (const customer of candidates) {
    // Checked here as well as in the send, so an opted-out customer does not even
    // get a queued run against their name.
    if (customer.optedOut) {
      report.skippedOptedOut += 1;
      continue;
    }

    const started = await fireTrigger(
      db,
      organizationId,
      AutomationTrigger.CUSTOMER_INACTIVE,
      { type: 'customer', id: customer.id },
      { now, rearmFinishedRuns: true },
    );

    if (started > 0) {
      report.started += 1;

      await db.customer.update({
        where: { id: customer.id },
        data: { nextServiceDueAt: addDays(now, inactiveDays) },
      });
    }
  }

  return report;
}

/** Marks a review request as having gone out. Used by the worker and by hand. */
export async function markReviewRequestSent(db: TenantClient, token: string): Promise<void> {
  const changed = await db.reviewRequest.updateMany({
    where: { token },
    data: { status: ReviewRequestStatus.SENT, sentAt: new Date() },
  });

  if (changed.count === 0) throw conflict('That review request no longer exists.');
}

export type SweepReport = {
  organizations: number;
  considered: number;
  started: number;
  skippedOptedOut: number;
};

/**
 * The reactivation sweep, across every workspace that wants it.
 *
 * Scoped to organizations with an **enabled** `CUSTOMER_INACTIVE` automation, so
 * a workspace that has never turned reactivation on costs nothing — rather than
 * one lapsed-customer query per workspace per pass, most of them to throw the
 * result away.
 *
 * Like the automation worker, the outer query is unscoped because this is not
 * acting for a signed-in user, but each sweep then runs through a tenant client
 * pinned to its own organization.
 */
export async function runReactivationSweepForAll(
  options: { inactiveDays?: number; now?: Date; limitPerOrganization?: number } = {},
): Promise<SweepReport> {
  const organizations = await prisma.organization.findMany({
    where: {
      status: 'ACTIVE',
      automations: { some: { trigger: AutomationTrigger.CUSTOMER_INACTIVE, enabled: true } },
    },
    select: { id: true },
  });

  const report: SweepReport = {
    organizations: organizations.length,
    considered: 0,
    started: 0,
    skippedOptedOut: 0,
  };

  for (const organization of organizations) {
    try {
      const result = await runReactivationSweep(forOrganization(organization.id), organization.id, {
        inactiveDays: options.inactiveDays,
        now: options.now,
        limit: options.limitPerOrganization,
      });

      report.considered += result.considered;
      report.started += result.started;
      report.skippedOptedOut += result.skippedOptedOut;
    } catch (error) {
      // One workspace's bad data must not stop every other workspace's sweep.
      console.error('[reactivation] sweep failed for one organization', {
        organizationId: organization.id,
        error,
      });
    }
  }

  return report;
}
