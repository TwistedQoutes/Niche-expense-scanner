import {
  AppointmentStatus,
  Channel,
  JobStatus,
  LeadSource,
  LeadStatus,
  MessageDirection,
  MessageStatus,
  Prisma,
  QuoteStatus,
  Urgency,
  ReviewRequestStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { addDays, addMinutes } from '@/lib/dates';
import { prisma } from '@/lib/db/client';
import { generatePublicId } from '@/lib/quotes/numbering';

/**
 * The data a demo workspace opens with.
 *
 * Written to look like eight months of a real lawn-care business rather than three
 * rows of "Test Customer": a prospect clicking Analytics on an empty workspace
 * learns nothing, and a pipeline with one card in it does not show what the board
 * is for.
 *
 * Every phone number is in the 555 range reserved for fiction, and every email is
 * on `example.test`. That is belt to the braces of the demo send-block — if the
 * block ever failed, the worst case is a message to a number that cannot exist.
 */

/**
 * A phone number for a person who does not exist.
 *
 * The 555 exchange is set aside precisely so fiction cannot ring a real person.
 * Exported so the invariant is testable as a value rather than as a grep over
 * this file — the demo send-block should never be the only thing standing
 * between a curious visitor and somebody's actual phone.
 */
export function demoPhone(index: number): string {
  return `+1512555${String(100 + index).padStart(4, '0')}`;
}

/** The address domain every seeded contact uses. `.test` can never be registered. */
export const DEMO_EMAIL_DOMAIN = 'example.test';

/** The throwaway account's domain. `.invalid` is guaranteed not to resolve. */
export const DEMO_ACCOUNT_DOMAIN = 'demo.invalid';

/** The business's own number in the demo, shown on its settings screen. */
export const DEMO_BUSINESS_PHONE = demoPhone(0);

type SeedCustomer = {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  jobs: number;
  lifetimeCents: number;
  lastServicedDaysAgo: number;
  nextDueDaysFromNow: number | null;
};

export const DEMO_CUSTOMERS: SeedCustomer[] = [
  { firstName: 'Dana', lastName: 'Whitfield', address: '12 Oak Lane', city: 'Austin', jobs: 9, lifetimeCents: 76_500, lastServicedDaysAgo: 6, nextDueDaysFromNow: 8 },
  { firstName: 'Marcus', lastName: 'Bell', address: '48 Cedar Ridge', city: 'Austin', jobs: 6, lifetimeCents: 54_000, lastServicedDaysAgo: 13, nextDueDaysFromNow: 1 },
  { firstName: 'Priya', lastName: 'Raman', address: '7 Willow Court', city: 'Round Rock', jobs: 4, lifetimeCents: 41_000, lastServicedDaysAgo: 74, nextDueDaysFromNow: -12 },
  { firstName: 'Tom', lastName: 'Ferreira', address: '203 Pine Street', city: 'Austin', jobs: 3, lifetimeCents: 33_500, lastServicedDaysAgo: 120, nextDueDaysFromNow: null },
  { firstName: 'Grace', lastName: 'Okonkwo', address: '91 Bluebonnet Way', city: 'Pflugerville', jobs: 2, lifetimeCents: 19_000, lastServicedDaysAgo: 21, nextDueDaysFromNow: 9 },
  { firstName: 'Hector', lastName: 'Salas', address: '15 Maple Drive', city: 'Austin', jobs: 1, lifetimeCents: 8_500, lastServicedDaysAgo: 3, nextDueDaysFromNow: 11 },
];

type SeedLead = {
  firstName: string;
  lastName: string;
  status: LeadStatus;
  source: LeadSource;
  service: string;
  description: string;
  /**
   * How long ago the enquiry came in, in hours.
   *
   * Hours rather than days because the newest cards would otherwise be stamped
   * "2 seconds ago" — which is not what a real business's board looks like, and
   * tells the prospect exactly when the data was invented.
   */
  hoursAgo: number;
  estimateCents: number | null;
  aiScore: number | null;
  aiSummary: string | null;
  aiUrgency: Urgency | null;
};

export const DEMO_LEADS: SeedLead[] = [
  {
    firstName: 'Renee', lastName: 'Alvarez', status: LeadStatus.NEW, source: LeadSource.WEBSITE,
    service: 'Lawn mowing', description: 'Front and back, roughly a quarter acre. Grass is getting long.',
    hoursAgo: 3, estimateCents: 9_000, aiScore: 82,
    aiSummary: 'Ready to book, standard residential mow, no obstacles mentioned.',
    aiUrgency: Urgency.HIGH,
  },
  {
    firstName: 'Owen', lastName: 'Pratt', status: LeadStatus.NEW, source: LeadSource.MISSED_CALL,
    service: null as unknown as string, description: 'Missed call. Texted back automatically.',
    hoursAgo: 1, estimateCents: null, aiScore: 55,
    aiSummary: 'Missed call with no message yet — worth ringing back.',
    aiUrgency: Urgency.MEDIUM,
  },
  {
    firstName: 'Sofia', lastName: 'Lindqvist', status: LeadStatus.CONTACTED, source: LeadSource.GOOGLE,
    service: 'Full yard cleanup', description: 'Moving in next month, yard has not been touched in a year.',
    hoursAgo: 2 * 24 + 5, estimateCents: 42_000, aiScore: 91,
    aiSummary: 'Large one-off cleanup, high value, deadline is the move-in date.',
    aiUrgency: Urgency.HIGH,
  },
  {
    firstName: 'Craig', lastName: 'Mbeki', status: LeadStatus.QUOTE_SENT, source: LeadSource.REFERRAL,
    service: 'Fertilisation', description: 'Neighbour recommended you. Wants a seasonal programme.',
    hoursAgo: 5 * 24, estimateCents: 28_000, aiScore: 88,
    aiSummary: 'Referral, recurring work, already sold on the service.',
    aiUrgency: Urgency.MEDIUM,
  },
  {
    firstName: 'Bea', lastName: 'Toussaint', status: LeadStatus.QUOTE_SENT, source: LeadSource.FACEBOOK,
    service: 'Mulch installation', description: 'About 12 beds around the house.',
    hoursAgo: 9 * 24, estimateCents: 61_000, aiScore: 74,
    aiSummary: 'Material-heavy job; confirm bed measurements before committing.',
    aiUrgency: Urgency.LOW,
  },
  {
    firstName: 'Neil', lastName: 'Ashworth', status: LeadStatus.LOST, source: LeadSource.WEBSITE,
    service: 'Lawn mowing', description: 'Asked for a price, went with someone cheaper.',
    hoursAgo: 24 * 24, estimateCents: 7_500, aiScore: 40,
    aiSummary: 'Price-sensitive, compared several quotes.',
    aiUrgency: Urgency.LOW,
  },
];

/**
 * Fills a freshly provisioned workspace with a business's worth of history.
 *
 * Takes the transaction client so the whole demo either exists or does not — a
 * half-seeded demo would show a prospect a broken product, which is worse than
 * showing them nothing.
 */
export async function seedDemoWorkspace(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<{ customers: number; leads: number; jobs: number }> {
  /*
   * A demo arrives already set up.
   *
   * Otherwise the first thing a prospect sees is a banner asking them to
   * configure a workspace that is deleted within the day — which reads as the
   * product not knowing its own state, on the one screen where first impressions
   * are the entire point.
   */
  await tx.organization.update({
    where: { id: organizationId },
    data: {
      onboardedAt: now,
      city: 'Austin',
      state: 'TX',
      reviewUrl: 'https://example.test/leave-a-review',
    },
  });

  const services = await tx.service.findMany({
    where: { organizationId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, basePriceCents: true },
  });

  const mowing = services[0] ?? null;

  // ── Customers, with the history that makes analytics worth opening ─────────
  const customerIds: string[] = [];

  for (const [index, seed] of DEMO_CUSTOMERS.entries()) {
    const customer = await tx.customer.create({
      data: {
        organizationId,
        firstName: seed.firstName,
        lastName: seed.lastName,
        email: `${seed.firstName.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`,
        phone: demoPhone(index),
        addressLine1: seed.address,
        city: seed.city,
        state: 'TX',
        postalCode: '78701',
        jobsCompleted: seed.jobs,
        lifetimeValueCents: seed.lifetimeCents,
        lastServicedAt: addDays(now, -seed.lastServicedDaysAgo),
        nextServiceDueAt:
          seed.nextDueDaysFromNow === null ? null : addDays(now, seed.nextDueDaysFromNow),
        tags: index === 0 ? ['weekly'] : [],
      },
      select: { id: true },
    });

    customerIds.push(customer.id);
  }

  // ── Completed work, spread across the year so the trend has a shape ────────
  let jobCount = 0;
  const completedJobIds: string[] = [];

  for (const [index, seed] of DEMO_CUSTOMERS.entries()) {
    // Spread each customer's jobs backwards from their last service date.
    for (let visit = 0; visit < Math.min(seed.jobs, 6); visit += 1) {
      const completedAt = addDays(now, -(seed.lastServicedDaysAgo + visit * 28));
      const priceCents = Math.round(seed.lifetimeCents / seed.jobs);

      jobCount += 1;

      const job = await tx.job.create({
        data: {
          organizationId,
          number: `JOB-${String(1000 + jobCount)}`,
          customerId: customerIds[index]!,
          serviceId: mowing?.id ?? null,
          status: JobStatus.COMPLETED,
          title: `${mowing?.name ?? 'Service'} — ${seed.address}`,
          priceCents,
          scheduledFor: completedAt,
          startedAt: completedAt,
          completedAt,
          completionNotes: visit === 0 ? 'All done, gate closed behind us.' : null,
        },
        select: { id: true },
      });

      completedJobIds.push(job.id);
    }
  }

  // ── The board: leads at every stage ────────────────────────────────────────
  const POSITION_GAP = 65_536;
  const perStatus = new Map<LeadStatus, number>();
  const leadIds: string[] = [];

  for (const [index, seed] of DEMO_LEADS.entries()) {
    const rank = perStatus.get(seed.status) ?? 0;
    perStatus.set(seed.status, rank + 1);

    const createdAt = addMinutes(now, -seed.hoursAgo * 60);

    const lead = await tx.lead.create({
      data: {
        organizationId,
        firstName: seed.firstName,
        lastName: seed.lastName,
        email: `${seed.firstName.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`,
        phone: demoPhone(50 + index),
        addressLine1: `${10 + index * 7} Demo Street`,
        city: 'Austin',
        state: 'TX',
        postalCode: '78702',
        source: seed.source,
        serviceRequested: seed.service ?? null,
        description: seed.description,
        status: seed.status,
        position: rank * POSITION_GAP,
        estimatedValueCents: seed.estimateCents,
        aiScore: seed.aiScore,
        aiSummary: seed.aiSummary,
        aiUrgency: seed.aiUrgency,
        aiQualifiedAt: seed.aiScore === null ? null : createdAt,
        aiModel: seed.aiScore === null ? null : 'demo',
        createdAt,
        lastContactedAt: seed.status === LeadStatus.NEW ? null : createdAt,
        closedAt:
          seed.status === LeadStatus.LOST ? addMinutes(createdAt, 3 * 24 * 60) : null,
        lostReason: seed.status === LeadStatus.LOST ? 'Went with a cheaper quote' : null,
      },
      select: { id: true },
    });

    leadIds.push(lead.id);
  }

  // ── Quotes waiting on an answer, which is the screen owners check ──────────
  const quotedLeads = DEMO_LEADS.map((seed, index) => ({ seed, id: leadIds[index]! })).filter(
    (entry) => entry.seed.status === LeadStatus.QUOTE_SENT,
  );

  for (const [index, entry] of quotedLeads.entries()) {
    const sentAt = addMinutes(now, -(entry.seed.hoursAgo - 24) * 60);
    const total = entry.seed.estimateCents ?? 20_000;

    await tx.quote.create({
      data: {
        organizationId,
        number: `Q-${String(1200 + index)}`,
        publicId: generatePublicId(),
        leadId: entry.id,
        status: index === 0 ? QuoteStatus.VIEWED : QuoteStatus.SENT,
        title: entry.seed.service,
        summary: entry.seed.description,
        currency: 'USD',
        laborMinutes: 120,
        laborRateCents: 6_500,
        laborCostCents: 13_000,
        estimatedCostCents: Math.round(total * 0.62),
        profitMarginBps: 3_800,
        subtotalCents: total,
        totalCents: total,
        sentAt,
        firstViewedAt: index === 0 ? addMinutes(sentAt, 90) : null,
        expiresAt: addDays(sentAt, 30),
        items: {
          create: [
            {
              // The line inherits its tenant from the quote, through the
              // composite foreign key.
              serviceId: mowing?.id ?? null,
              name: entry.seed.service,
              quantityMilli: 1_000,
              unitPriceCents: total,
              totalCents: total,
              taxable: false,
              optional: false,
              position: 0,
            },
          ],
        },
      },
    });
  }

  // ── This week's diary ──────────────────────────────────────────────────────
  for (const [index, customerId] of customerIds.slice(0, 4).entries()) {
    const start = addMinutes(addDays(now, index === 0 ? 0 : index), 9 * 60 + index * 90);

    const job = await tx.job.create({
      data: {
        organizationId,
        number: `JOB-${String(2000 + index)}`,
        customerId,
        serviceId: mowing?.id ?? null,
        status: index === 0 ? JobStatus.IN_PROGRESS : JobStatus.CONFIRMED,
        title: `${mowing?.name ?? 'Service'} — ${DEMO_CUSTOMERS[index]!.address}`,
        priceCents: mowing?.basePriceCents ?? 8_500,
        scheduledFor: start,
        ...(index === 0 ? { startedAt: start } : {}),
      },
      select: { id: true },
    });

    await tx.appointment.create({
      data: {
        organizationId,
        jobId: job.id,
        customerId,
        serviceId: mowing?.id ?? null,
        title: `${mowing?.name ?? 'Service'} — ${DEMO_CUSTOMERS[index]!.firstName}`,
        startsAt: start,
        endsAt: addMinutes(start, 60),
        status: index === 0 ? AppointmentStatus.CONFIRMED : AppointmentStatus.SCHEDULED,
        addressLine1: DEMO_CUSTOMERS[index]!.address,
        city: DEMO_CUSTOMERS[index]!.city,
        state: 'TX',
        estimatedRevenueCents: mowing?.basePriceCents ?? 8_500,
      },
    });
  }

  // ── A conversation, so the inbox is not empty ──────────────────────────────
  const conversation = await tx.conversation.create({
    data: {
      organizationId,
      customerId: customerIds[0]!,
      channel: Channel.SMS,
      contact: demoPhone(0),
      lastMessageAt: addMinutes(now, -40),
      unreadCount: 1,
    },
    select: { id: true },
  });

  await tx.message.createMany({
    data: [
      {
        organizationId,
        conversationId: conversation.id,
        channel: Channel.SMS,
        direction: MessageDirection.OUTBOUND,
        status: MessageStatus.SENT,
        toAddress: demoPhone(0),
        body: 'Hi Dana — we are booked in for Thursday morning. Anything you want us to watch out for?',
        sentAt: addMinutes(now, -95),
      },
      {
        organizationId,
        conversationId: conversation.id,
        channel: Channel.SMS,
        direction: MessageDirection.INBOUND,
        status: MessageStatus.RECEIVED,
        fromAddress: demoPhone(0),
        body: 'Please avoid the flowerbed by the back fence — just planted it. Thanks!',
        sentAt: addMinutes(now, -40),
      },
    ],
  });

  // ── A review request that was tapped ───────────────────────────────────────
  if (completedJobIds[0]) {
    await tx.reviewRequest.create({
      data: {
        organizationId,
        customerId: customerIds[0]!,
        jobId: completedJobIds[0],
        channel: Channel.SMS,
        status: ReviewRequestStatus.CLICKED,
        token: randomBytes(16).toString('base64url'),
        reviewUrl: 'https://example.test/leave-a-review',
        sentAt: addDays(now, -5),
        clickedAt: addDays(now, -5),
      },
    });
  }

  return { customers: customerIds.length, leads: leadIds.length, jobs: jobCount + 4 };
}

/**
 * Removes demo workspaces past their time to live.
 *
 * Run from the daily sweep. Without it every curious visitor leaves a permanent
 * workspace behind, and within a month the platform's own numbers are mostly
 * people who looked once.
 *
 * The cascade on Organization takes the leads, customers, jobs and messages with
 * it; the throwaway user is deleted separately because it is not owned by the
 * workspace. Scoped to `isDemo` every time — a bug here that widened the filter
 * would delete paying customers, so the filter is never built dynamically.
 */
export async function deleteExpiredDemos(options: {
  ttlHours: number;
  now?: Date;
}): Promise<{ organizations: number; users: number }> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.ttlHours * 3_600_000);

  const expired = await prisma.organization.findMany({
    where: { isDemo: true, createdAt: { lt: cutoff } },
    select: { id: true, memberships: { select: { userId: true } } },
  });

  if (expired.length === 0) return { organizations: 0, users: 0 };

  const userIds = expired.flatMap((organization) =>
    organization.memberships.map((membership) => membership.userId),
  );

  await prisma.organization.deleteMany({
    where: { id: { in: expired.map((organization) => organization.id) }, isDemo: true },
  });

  /*
   * Only users left with no workspace at all, and only the throwaway addresses
   * this route issues. A real person who was invited into a demo must not be
   * deleted along with it.
   */
  const users = await prisma.user.deleteMany({
    where: {
      id: { in: userIds },
      email: { endsWith: `@${DEMO_ACCOUNT_DOMAIN}` },
      memberships: { none: {} },
    },
  });

  return { organizations: expired.length, users: users.count };
}
