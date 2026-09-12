import { AutomationTrigger, JobStatus, Prisma } from '@prisma/client';

import { conflict, notFound, validationFailed } from '@/lib/api/errors';
import { cancelRuns, fireTrigger } from '@/lib/automations/trigger';
import { addDays } from '@/lib/dates';
import type { TenantClient } from '@/lib/db/tenant';
import { nextNumber, withNumberRetry } from '@/lib/quotes/numbering';
import { findConflicts, describeConflict } from '@/lib/scheduling/repository';
import { addMinutes } from '@/lib/dates';
import { parseLocalDateTime } from '@/lib/dates';

/**
 * Jobs: the work itself.
 *
 * A job is created when a quote is accepted (see `quotes/repository.ts`) or by
 * hand for work that never had a quote — a regular customer who rings up. From
 * there it moves SCHEDULED → CONFIRMED → IN_PROGRESS → COMPLETED, or to
 * CANCELLED from anywhere before that.
 *
 * Completion is the event the rest of the product hangs off: it is when revenue
 * becomes real, when the customer's lifetime value moves, and when the review ask
 * is triggered. It is therefore also the one transition that must be impossible
 * to apply twice.
 */

const JOB_SELECT = {
  id: true,
  number: true,
  title: true,
  description: true,
  status: true,
  priceCents: true,
  currency: true,
  scheduledFor: true,
  startedAt: true,
  completedAt: true,
  completionNotes: true,
  cancelledAt: true,
  cancelReason: true,
  notes: true,
  assignedUserId: true,
  createdAt: true,
  customer: {
    select: { id: true, firstName: true, lastName: true, phone: true, email: true },
  },
  quote: { select: { id: true, number: true, totalCents: true } },
  service: { select: { id: true, name: true } },
  assignedUser: { select: { id: true, name: true } },
  appointments: {
    where: { status: { not: 'CANCELLED' as const } },
    select: { id: true, title: true, startsAt: true, endsAt: true, status: true },
    orderBy: { startsAt: 'asc' as const },
  },
} satisfies Prisma.JobSelect;

export type JobRow = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

/**
 * Which transitions are legal.
 *
 * Written out rather than checked ad hoc at each call site: "can this job be
 * completed?" needs one answer, and a screen that offers a button the API will
 * refuse is worse than no button.
 */
const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  [JobStatus.SCHEDULED]: [JobStatus.CONFIRMED, JobStatus.IN_PROGRESS, JobStatus.CANCELLED],
  [JobStatus.CONFIRMED]: [JobStatus.IN_PROGRESS, JobStatus.COMPLETED, JobStatus.CANCELLED],
  [JobStatus.IN_PROGRESS]: [JobStatus.COMPLETED, JobStatus.CANCELLED],
  // Terminal. A completed job that turns out to be wrong is corrected by editing
  // it, not by moving it backwards through a state that would re-fire the review
  // ask and re-count the revenue.
  [JobStatus.COMPLETED]: [],
  [JobStatus.CANCELLED]: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const TERMINAL_STATUSES: JobStatus[] = [JobStatus.COMPLETED, JobStatus.CANCELLED];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export async function listJobs(
  db: TenantClient,
  options: { status?: JobStatus; customerId?: string; cursor?: string; limit?: number } = {},
) {
  const limit = options.limit ?? 50;

  const rows = await db.job.findMany({
    where: {
      ...(options.status ? { status: options.status } : {}),
      ...(options.customerId ? { customerId: options.customerId } : {}),
    },
    select: JOB_SELECT,
    /*
     * Unscheduled first, then soonest. An owner's question is "what do I still
     * need to book?" followed by "what is next?", and nulls-last on scheduledFor
     * answers both in one list.
     */
    orderBy: [{ scheduledFor: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  return {
    jobs: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}

export async function getJob(db: TenantClient, id: string): Promise<JobRow> {
  const job = await db.job.findUnique({ where: { id }, select: JOB_SELECT });
  if (!job) throw notFound('That job does not exist.');
  return job;
}

export type CreateJobInput = {
  customerId: string;
  title: string;
  description?: string;
  serviceId?: string;
  propertyId?: string;
  quoteId?: string;
  priceCents?: number;
  notes?: string;
};

export async function createJob(
  db: TenantClient,
  organizationId: string,
  input: CreateJobInput,
): Promise<JobRow> {
  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true },
  });
  if (!customer) throw notFound('That customer does not exist.');

  return withNumberRetry(
    async (number) =>
      db.job.create({
        data: {
          organizationId,
          number,
          customerId: input.customerId,
          serviceId: input.serviceId ?? null,
          propertyId: input.propertyId ?? null,
          quoteId: input.quoteId ?? null,
          status: JobStatus.SCHEDULED,
          title: input.title,
          description: input.description ?? null,
          priceCents: input.priceCents ?? 0,
          notes: input.notes ?? null,
        },
        select: JOB_SELECT,
      }),
    () => nextNumber(db, 'job'),
  );
}

export async function updateJob(
  db: TenantClient,
  id: string,
  input: {
    title?: string;
    description?: string;
    priceCents?: number;
    assignedUserId?: string | null;
    notes?: string;
  },
): Promise<JobRow> {
  const existing = await db.job.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!existing) throw notFound('That job does not exist.');

  if (input.assignedUserId) {
    /*
     * Membership, not just the user row: a user who belongs to another workspace
     * exists, and assigning them here would leak that they do — and put a job in
     * a stranger's queue. The tenant client scopes memberships to this
     * organization, so an unmatched id is simply "not a teammate".
     */
    const membership = await db.membership.findFirst({
      where: { userId: input.assignedUserId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!membership) throw notFound('That teammate is not in this workspace.');
  }

  return db.job.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
      ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    select: JOB_SELECT,
  });
}

/**
 * Books a job onto the calendar.
 *
 * The job's `scheduledFor` and its appointment are written together, because a
 * job that says Tuesday while its appointment says Wednesday is an inconsistency
 * the crew discovers at a customer's gate. The appointment is created on the
 * first call and moved on subsequent ones, rather than accumulating one row per
 * reschedule.
 */
export async function scheduleJob(
  db: TenantClient,
  organizationId: string,
  timeZone: string,
  id: string,
  input: {
    date: string;
    time: string;
    durationMinutes: number;
    assignedUserId?: string | null;
    allowConflict?: boolean;
  },
): Promise<JobRow> {
  const job = await db.job.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      title: true,
      priceCents: true,
      assignedUserId: true,
      customerId: true,
      serviceId: true,
      customer: {
        select: { addressLine1: true, city: true, state: true, postalCode: true },
      },
      appointments: {
        where: { status: { not: 'CANCELLED' } },
        select: { id: true },
        orderBy: { startsAt: 'asc' },
        take: 1,
      },
    },
  });
  if (!job) throw notFound('That job does not exist.');

  if (isTerminal(job.status)) {
    throw conflict(
      job.status === JobStatus.COMPLETED
        ? 'That job is already finished, so it cannot be rescheduled.'
        : 'That job was cancelled. Create a new one to book the work again.',
    );
  }

  const startsAt = parseLocalDateTime(input.date, input.time, timeZone);

  // A validation failure, not a conflict: the input is wrong, nothing collided.
  // The distinction matters to the client, which shows a clash as a decision to
  // confirm and bad input as a field to correct.
  if (!startsAt) throw validationFailed({ date: 'That is not a date and time we can book.' });

  const interval = { startsAt, endsAt: addMinutes(startsAt, input.durationMinutes) };
  const assignedUserId =
    input.assignedUserId !== undefined ? input.assignedUserId : job.assignedUserId;

  const existingAppointment = job.appointments[0]?.id ?? null;

  if (!input.allowConflict) {
    const clashes = await findConflicts(db, interval, {
      assignedUserId,
      ...(existingAppointment ? { excludeAppointmentId: existingAppointment } : {}),
    });

    if (clashes.length > 0) throw conflict(describeConflict(clashes, timeZone));
  }

  if (assignedUserId) {
    const membership = await db.membership.findFirst({
      where: { userId: assignedUserId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!membership) throw notFound('That teammate is not in this workspace.');
  }

  if (existingAppointment) {
    await db.appointment.update({
      where: { id: existingAppointment },
      data: { startsAt: interval.startsAt, endsAt: interval.endsAt },
    });
  } else {
    await db.appointment.create({
      data: {
        organizationId,
        jobId: job.id,
        customerId: job.customerId,
        serviceId: job.serviceId,
        title: `${job.title} — ${job.number}`,
        startsAt: interval.startsAt,
        endsAt: interval.endsAt,
        // Copied from the customer so the crew has an address on the calendar
        // without a join, and so editing the customer later does not silently
        // move today's visit.
        addressLine1: job.customer.addressLine1,
        city: job.customer.city,
        state: job.customer.state,
        postalCode: job.customer.postalCode,
        estimatedRevenueCents: job.priceCents,
      },
    });
  }

  return db.job.update({
    where: { id },
    data: {
      scheduledFor: interval.startsAt,
      ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
      // Booking a job confirms it: the customer has a time, which is what
      // CONFIRMED means.
      ...(job.status === JobStatus.SCHEDULED ? { status: JobStatus.CONFIRMED } : {}),
    },
    select: JOB_SELECT,
  });
}

export async function startJob(db: TenantClient, id: string): Promise<JobRow> {
  const job = await db.job.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!job) throw notFound('That job does not exist.');

  if (job.status === JobStatus.IN_PROGRESS) {
    // Already started. Returning it unchanged rather than erroring: a crew
    // tapping "start" twice on a poor connection is not a mistake to report.
    return getJob(db, id);
  }

  if (!canTransition(job.status, JobStatus.IN_PROGRESS)) {
    throw conflict(`A ${job.status.toLowerCase().replace('_', ' ')} job cannot be started.`);
  }

  /*
   * Claimed with a conditional update. Two crew members tapping "start" at once
   * would otherwise both pass the check above and both write a startedAt, and the
   * later write would move the start time of a job already under way.
   */
  const claimed = await db.job.updateMany({
    where: { id, status: job.status },
    data: { status: JobStatus.IN_PROGRESS, startedAt: new Date() },
  });

  if (claimed.count === 0) return getJob(db, id);

  return getJob(db, id);
}

export type CompleteJobResult = {
  job: JobRow;
  /** False when the job was already complete, so the caller can stay quiet. */
  changed: boolean;
};

/**
 * Finishing a job.
 *
 * Everything irreversible in this product happens here, which is why the write is
 * a conditional update rather than a read-then-write: the customer's lifetime
 * value and completed count are *increments*, and applying them twice is not a
 * display bug but a wrong number in the owner's books that nothing later corrects.
 *
 * A second call therefore does nothing and says so.
 */
export async function completeJob(
  db: TenantClient,
  organizationId: string,
  id: string,
  input: { completionNotes?: string; finalPriceCents?: number; nextServiceDays?: number } = {},
): Promise<CompleteJobResult> {
  const job = await db.job.findUnique({
    where: { id },
    select: { id: true, number: true, status: true, priceCents: true, customerId: true },
  });
  if (!job) throw notFound('That job does not exist.');

  if (job.status === JobStatus.COMPLETED) {
    return { job: await getJob(db, id), changed: false };
  }

  if (!canTransition(job.status, JobStatus.COMPLETED)) {
    throw conflict(
      job.status === JobStatus.CANCELLED
        ? 'That job was cancelled, so it cannot be completed.'
        : 'Confirm or start the job before completing it.',
    );
  }

  const now = new Date();
  const finalPrice = input.finalPriceCents ?? job.priceCents;

  /*
   * The lock. `status: job.status` means only the first caller's update matches;
   * a second concurrent completion matches nothing and takes the early return
   * below, leaving the rollups applied exactly once.
   */
  const claimed = await db.job.updateMany({
    where: { id, status: job.status },
    data: {
      status: JobStatus.COMPLETED,
      completedAt: now,
      completionNotes: input.completionNotes ?? null,
      priceCents: finalPrice,
    },
  });

  if (claimed.count === 0) {
    return { job: await getJob(db, id), changed: false };
  }

  await db.customer.update({
    where: { id: job.customerId },
    data: {
      jobsCompleted: { increment: 1 },
      lifetimeValueCents: { increment: finalPrice },
      lastServicedAt: now,
      ...(input.nextServiceDays
        ? { nextServiceDueAt: addDays(now, input.nextServiceDays) }
        : {}),
    },
  });

  // Nothing is still chasing a job that is done.
  await cancelRuns(db, { type: 'job', id }, { reason: 'job completed' });

  await db.notification.create({
    data: {
      organizationId,
      userId: null,
      type: 'job.completed',
      title: `Job ${job.number} completed`,
      body: 'A review request is on its way if that automation is on.',
      href: `/jobs/${id}`,
    },
  });

  // The review ask. An automation rather than a hard-coded send, so an owner can
  // change its wording and timing, or turn it off.
  await fireTrigger(db, organizationId, AutomationTrigger.JOB_COMPLETED, { type: 'job', id });

  return { job: await getJob(db, id), changed: true };
}

export async function cancelJob(
  db: TenantClient,
  id: string,
  reason?: string,
): Promise<JobRow> {
  const job = await db.job.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!job) throw notFound('That job does not exist.');

  if (job.status === JobStatus.CANCELLED) return getJob(db, id);

  if (!canTransition(job.status, JobStatus.CANCELLED)) {
    throw conflict('A completed job cannot be cancelled. Edit it instead.');
  }

  await db.job.updateMany({
    where: { id, status: job.status },
    data: { status: JobStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason ?? null },
  });

  // The slot goes back on the calendar, and nothing keeps chasing the job.
  await db.appointment.updateMany({
    where: { jobId: id, status: { not: 'CANCELLED' } },
    data: { status: 'CANCELLED' },
  });

  await cancelRuns(db, { type: 'job', id }, { reason: 'job cancelled' });

  return getJob(db, id);
}

/** Counts per status, for the tabs on the jobs screen. */
export async function jobCounts(db: TenantClient): Promise<Record<JobStatus, number>> {
  const grouped = await db.job.groupBy({ by: ['status'], _count: { _all: true } });

  const counts = Object.fromEntries(
    Object.values(JobStatus).map((status) => [status, 0]),
  ) as Record<JobStatus, number>;

  for (const row of grouped) counts[row.status] = row._count._all;

  return counts;
}
