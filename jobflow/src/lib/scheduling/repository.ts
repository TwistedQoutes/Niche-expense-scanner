import { AppointmentStatus, JobStatus, Prisma } from '@prisma/client';

import { conflict, notFound, validationFailed } from '@/lib/api/errors';
import { instantToWallClock, localDayRange, localWeekDays, parseLocalDateTime } from '@/lib/dates';
import type { TenantClient } from '@/lib/db/tenant';
import { addMinutes } from '@/lib/dates';
import { overlaps, type Interval } from '@/lib/scheduling/overlap';

/**
 * Appointments and the calendar.
 *
 * The one rule that matters here: **an appointment's instants are derived from the
 * business's own timezone, never from the caller's.** Everything else is
 * bookkeeping around that.
 */

const APPOINTMENT_SELECT = {
  id: true,
  title: true,
  status: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  addressLine1: true,
  city: true,
  state: true,
  postalCode: true,
  estimatedRevenueCents: true,
  notes: true,
  customerId: true,
  jobId: true,
  serviceId: true,
  customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
  job: { select: { id: true, number: true, status: true, assignedUserId: true } },
  service: { select: { id: true, name: true } },
} satisfies Prisma.AppointmentSelect;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof APPOINTMENT_SELECT }>;

/** Statuses that still occupy a slot. A cancelled visit frees the time. */
const BLOCKING_STATUSES = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED];

export type ConflictingAppointment = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  assignedUserId: string | null;
};

/**
 * Appointments already in this slot.
 *
 * Queried as a half-open range rather than filtered in memory: a calendar with
 * two years of history in it should not be loaded to book one visit. The SQL
 * condition is the same rule as `overlaps` — `startsAt < newEnd AND endsAt >
 * newStart` — and `tests/scheduling.test.ts` checks the two agree, because the
 * duplicated logic is exactly the kind that drifts.
 */
export async function findConflicts(
  db: TenantClient,
  interval: Interval,
  options: { assignedUserId?: string | null; excludeAppointmentId?: string } = {},
): Promise<ConflictingAppointment[]> {
  const candidates = await db.appointment.findMany({
    where: {
      status: { in: BLOCKING_STATUSES },
      startsAt: { lt: interval.endsAt },
      endsAt: { gt: interval.startsAt },
      ...(options.excludeAppointmentId ? { id: { not: options.excludeAppointmentId } } : {}),
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      job: { select: { assignedUserId: true } },
    },
    orderBy: { startsAt: 'asc' },
    take: 20,
  });

  const rows = candidates.map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    assignedUserId: row.job?.assignedUserId ?? null,
  }));

  /*
   * Who is busy, not what is booked.
   *
   * A business with two crews can run two jobs at once, so an unassigned visit
   * clashing with an assigned one is not a clash worth blocking. When the new
   * booking names a person, only that person's existing visits count; when it
   * does not, the slot itself is what is being reserved and everything in it
   * counts.
   */
  if (options.assignedUserId) {
    return rows.filter(
      (row) => row.assignedUserId === null || row.assignedUserId === options.assignedUserId,
    );
  }

  return rows;
}

export type CreateAppointmentInput = {
  title: string;
  date: string;
  time: string;
  durationMinutes: number;
  customerId?: string;
  jobId?: string;
  serviceId?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  estimatedRevenueCents?: number;
  notes?: string;
  allowConflict?: boolean;
};

/**
 * Turns the form's date and time into the instants to store.
 *
 * Fails as a validation error rather than a 500: a date the business's calendar
 * does not have is a bad input, not a broken server.
 */
export function resolveInterval(
  input: { date: string; time: string; durationMinutes: number },
  timeZone: string,
): Interval {
  const startsAt = parseLocalDateTime(input.date, input.time, timeZone);

  if (!startsAt) {
    throw validationFailed({ date: 'That is not a date and time we can book.' });
  }

  return { startsAt, endsAt: addMinutes(startsAt, input.durationMinutes) };
}

export async function createAppointment(
  db: TenantClient,
  organizationId: string,
  timeZone: string,
  input: CreateAppointmentInput,
): Promise<AppointmentRow> {
  const interval = resolveInterval(input, timeZone);

  if (!input.allowConflict) {
    const clashes = await findConflicts(db, interval);

    if (clashes.length > 0) {
      throw conflict(describeConflict(clashes, timeZone));
    }
  }

  // Existence is checked rather than assumed: Prisma would raise a foreign-key
  // error, which reaches the client as a 500 instead of a message about the
  // customer having been deleted in another tab.
  if (input.customerId) {
    const customer = await db.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true },
    });
    if (!customer) throw notFound('That customer does not exist.');
  }

  if (input.jobId) {
    const job = await db.job.findUnique({ where: { id: input.jobId }, select: { id: true } });
    if (!job) throw notFound('That job does not exist.');
  }

  return db.appointment.create({
    data: {
      organizationId,
      title: input.title,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
      customerId: input.customerId ?? null,
      jobId: input.jobId ?? null,
      serviceId: input.serviceId ?? null,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      estimatedRevenueCents: input.estimatedRevenueCents ?? 0,
      notes: input.notes ?? null,
    },
    select: APPOINTMENT_SELECT,
  });
}

/** "Clashes with Mowing — Dana Reply (Tue 10 Mar, 9:00 AM)." */
export function describeConflict(
  clashes: ReadonlyArray<{ title: string; startsAt: Date }>,
  timeZone: string,
): string {
  const first = clashes[0]!;
  const when = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(first.startsAt);

  const others =
    clashes.length > 1
      ? ` and ${clashes.length - 1} other${clashes.length > 2 ? 's' : ''}`
      : '';

  return `That time clashes with “${first.title}” at ${when}${others}. Choose another time, or book it anyway.`;
}

export async function updateAppointment(
  db: TenantClient,
  timeZone: string,
  id: string,
  input: Partial<CreateAppointmentInput> & { status?: AppointmentStatus },
): Promise<AppointmentRow> {
  const existing = await db.appointment.findUnique({
    where: { id },
    select: { id: true, startsAt: true, endsAt: true, jobId: true },
  });
  if (!existing) throw notFound('That appointment does not exist.');

  const data: Prisma.AppointmentUpdateInput = {};

  if (input.date && input.time) {
    const minutes =
      input.durationMinutes ??
      Math.round((existing.endsAt.getTime() - existing.startsAt.getTime()) / 60_000);

    const interval = resolveInterval(
      { date: input.date, time: input.time, durationMinutes: minutes },
      timeZone,
    );

    if (!input.allowConflict) {
      const clashes = await findConflicts(db, interval, { excludeAppointmentId: id });
      if (clashes.length > 0) throw conflict(describeConflict(clashes, timeZone));
    }

    data.startsAt = interval.startsAt;
    data.endsAt = interval.endsAt;

    // The job carries the same time, so a reschedule cannot leave the two
    // disagreeing about when the crew is turning up.
    if (existing.jobId) {
      await db.job.updateMany({
        where: { id: existing.jobId },
        data: { scheduledFor: interval.startsAt },
      });
    }
  } else if (input.durationMinutes !== undefined) {
    // Duration alone: the start stands and the end moves.
    const interval = { startsAt: existing.startsAt, endsAt: addMinutes(existing.startsAt, input.durationMinutes) };

    if (!input.allowConflict) {
      const clashes = await findConflicts(db, interval, { excludeAppointmentId: id });
      if (clashes.length > 0) throw conflict(describeConflict(clashes, timeZone));
    }

    data.endsAt = interval.endsAt;
  }

  if (input.title !== undefined) data.title = input.title;
  if (input.status !== undefined) data.status = input.status;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
  if (input.city !== undefined) data.city = input.city;
  if (input.state !== undefined) data.state = input.state;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode;
  if (input.estimatedRevenueCents !== undefined) {
    data.estimatedRevenueCents = input.estimatedRevenueCents;
  }

  const updated = await db.appointment.update({
    where: { id },
    data,
    select: APPOINTMENT_SELECT,
  });

  return updated;
}

export async function cancelAppointment(db: TenantClient, id: string): Promise<void> {
  const changed = await db.appointment.updateMany({
    where: { id },
    data: { status: AppointmentStatus.CANCELLED },
  });

  // updateMany rather than update, so a missing row is a 404 instead of a
  // Prisma P2025 escaping as a 500.
  if (changed.count === 0) throw notFound('That appointment does not exist.');
}

export type CalendarDay = {
  /** `YYYY-MM-DD` in the business's timezone. */
  date: string;
  appointments: AppointmentRow[];
  bookedMinutes: number;
  estimatedRevenueCents: number;
};

export type CalendarView = {
  days: CalendarDay[];
  /** The whole range, for the previous/next links. */
  start: Date;
  end: Date;
  timeZone: string;
  totalEstimatedRevenueCents: number;
};

/**
 * The calendar.
 *
 * One query for the range, then bucketed into the business's own days — as
 * opposed to a query per day, which is seven round trips for a week view and
 * would still get the boundaries wrong on a clock-change weekend.
 */
export async function loadCalendar(
  db: TenantClient,
  timeZone: string,
  options: { anchorDate: string; view: 'day' | 'week' },
): Promise<CalendarView> {
  const dayKeys =
    options.view === 'day'
      ? [options.anchorDate]
      : (localWeekDays(options.anchorDate, timeZone) ?? [options.anchorDate]);

  const firstRange = localDayRange(dayKeys[0]!, timeZone);
  const lastRange = localDayRange(dayKeys.at(-1)!, timeZone);

  if (!firstRange || !lastRange) {
    throw validationFailed({ date: 'That is not a date we can show.' });
  }

  const appointments = await db.appointment.findMany({
    where: {
      startsAt: { lt: lastRange.end },
      endsAt: { gt: firstRange.start },
      status: { not: AppointmentStatus.CANCELLED },
    },
    select: APPOINTMENT_SELECT,
    orderBy: { startsAt: 'asc' },
  });

  const days: CalendarDay[] = dayKeys.map((date) => {
    const range = localDayRange(date, timeZone)!;

    const inDay = appointments.filter((appointment) =>
      overlaps(
        { startsAt: appointment.startsAt, endsAt: appointment.endsAt },
        { startsAt: range.start, endsAt: range.end },
      ),
    );

    return {
      date,
      appointments: inDay,
      bookedMinutes: inDay.reduce(
        (total, appointment) =>
          total +
          Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000),
        0,
      ),
      estimatedRevenueCents: inDay.reduce(
        (total, appointment) => total + appointment.estimatedRevenueCents,
        0,
      ),
    };
  });

  return {
    days,
    start: firstRange.start,
    end: lastRange.end,
    timeZone,
    /*
     * Summed over the appointments, not over the days: a visit that spans
     * midnight appears in both days' lists, and adding the day totals would count
     * its value twice.
     */
    totalEstimatedRevenueCents: appointments.reduce(
      (total, appointment) => total + appointment.estimatedRevenueCents,
      0,
    ),
  };
}

/** Today's agenda for the dashboard: what the crew is doing now and next. */
export async function loadTodayAgenda(
  db: TenantClient,
  timeZone: string,
  now: Date = new Date(),
): Promise<AppointmentRow[]> {
  const wall = instantToWallClock(now, timeZone);
  const today = [
    String(wall.year).padStart(4, '0'),
    String(wall.month).padStart(2, '0'),
    String(wall.day).padStart(2, '0'),
  ].join('-');

  const range = localDayRange(today, timeZone);
  if (!range) return [];

  return db.appointment.findMany({
    where: {
      startsAt: { lt: range.end },
      endsAt: { gt: range.start },
      status: { not: AppointmentStatus.CANCELLED },
    },
    select: APPOINTMENT_SELECT,
    orderBy: { startsAt: 'asc' },
  });
}

/** Jobs with no appointment yet — the list an owner actually works from. */
export async function loadUnscheduledJobs(db: TenantClient, limit = 20) {
  return db.job.findMany({
    where: {
      status: { in: [JobStatus.SCHEDULED, JobStatus.CONFIRMED] },
      scheduledFor: null,
    },
    select: {
      id: true,
      number: true,
      title: true,
      priceCents: true,
      createdAt: true,
      customer: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}
