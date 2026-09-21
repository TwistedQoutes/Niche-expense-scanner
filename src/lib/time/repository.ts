import { JobStatus, Prisma, Role } from '@prisma/client';

import { conflict, notFound } from '@/lib/api/errors';
import { forgetPosition } from '@/lib/crew/repository';
import type { TenantClient } from '@/lib/db/tenant';
import { describeProximity, type Proximity } from '@/lib/geo/distance';
import { startJob } from '@/lib/jobs/repository';
import type { ClockInInput, ClockOutInput } from '@/lib/validation/time';

/**
 * The clock.
 *
 * Reading this file it is worth holding on to who the two users are, because
 * almost every decision below is a choice between them. One is a crew member
 * standing in somebody's garden with a phone, in the sun, with gloves on, on one
 * bar of signal. The other is an owner in a truck trying to work out whether
 * Tuesday made money. The crew member's experience has to be a single tap that
 * always works; the owner's needs a record they can trust. Where those conflict,
 * the tap wins and the record says what it does not know.
 *
 * Which is why nothing here fails because of location. A denied permission, a
 * phone that cannot see the sky, an old browser: all of them clock you in. The
 * pin is evidence, and evidence is allowed to be missing. Time is the record.
 */

const ENTRY_SELECT = {
  id: true,
  jobId: true,
  userId: true,
  startedAt: true,
  endedAt: true,
  startLatitude: true,
  startLongitude: true,
  startAccuracyMetres: true,
  startLocationNote: true,
  endLatitude: true,
  endLongitude: true,
  endAccuracyMetres: true,
  endLocationNote: true,
  note: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.TimeEntrySelect;

export type TimeEntryRow = Prisma.TimeEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

/**
 * Whose pins you may look at.
 *
 * The same line that guards pay, for a related reason. A timesheet is about
 * somebody's wages, and where they were at 2pm on Tuesday is about their day:
 * neither is a colleague's business. Owners and admins can see the crew's,
 * because that is what running a crew means, and everyone can see their own.
 */
export function maySeeLocationOf(
  viewer: { role: Role; userId: string },
  entryUserId: string,
): boolean {
  if (viewer.userId === entryUserId) return true;
  return viewer.role === Role.OWNER || viewer.role === Role.ADMIN;
}

/** Minutes between the ends of an entry, or null while it is still open. */
export function entryMinutes(entry: { startedAt: Date; endedAt: Date | null }): number | null {
  if (!entry.endedAt) return null;

  const minutes = (entry.endedAt.getTime() - entry.startedAt.getTime()) / 60_000;
  // A negative span means the clock moved, not that somebody worked backwards.
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

/**
 * An entry nobody closed.
 *
 * Somebody finished at four and drove home with the app in their pocket. By the
 * morning that entry reads as nineteen hours, and if the cost view counted it
 * the job would appear to have lost hundreds of pounds on labour that was
 * actually a forgotten tap.
 *
 * Twelve hours is deliberately generous — long summer days are real — and the
 * consequence of crossing it is never deletion or truncation. It is a flag: the
 * screen says the entry looks forgotten, the hours are left out of the cost
 * until a human resolves it, and the record still says exactly what happened.
 */
export const FORGOTTEN_AFTER_MINUTES = 12 * 60;

export function looksForgotten(entry: { startedAt: Date; endedAt: Date | null }, now = new Date()): boolean {
  if (entry.endedAt) return false;
  return (now.getTime() - entry.startedAt.getTime()) / 60_000 > FORGOTTEN_AFTER_MINUTES;
}

async function requireLiveJob(db: TenantClient, jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      number: true,
      status: true,
      property: { select: { latitude: true, longitude: true } },
    },
  });

  if (!job) throw notFound('That job does not exist.');

  if (job.status === JobStatus.CANCELLED) {
    throw conflict('That job was cancelled, so there are no hours to record against it.');
  }

  return job;
}

export type ClockInResult = {
  entry: TimeEntryRow;
  /** False when they were already on the clock here, so the UI can stay quiet. */
  changed: boolean;
  /** What can honestly be said about where they were. */
  proximity: Proximity;
};

/**
 * Starting the clock.
 *
 * Also starts the job, when the job has not started. Arriving and starting work
 * are the same event as far as a crew member is concerned, and asking them to
 * tap two buttons to say one thing is how the second tap stops happening —
 * leaving a database full of jobs that were worked but never marked as under
 * way.
 */
export async function clockIn(
  db: TenantClient,
  organizationId: string,
  jobId: string,
  userId: string,
  input: ClockInInput = {},
): Promise<ClockInResult> {
  const job = await requireLiveJob(db, jobId);

  if (job.status === JobStatus.COMPLETED) {
    throw conflict('That job is finished. Reopen it or log the hours by hand.');
  }

  /*
   * Already on the clock somewhere.
   *
   * The database will refuse a second open entry whatever happens (see the
   * partial unique index in the migration), so this read is not the guarantee —
   * it is the good error message. Without it the crew member gets a unique
   * constraint violation, which tells them nothing about the job they forgot to
   * clock out of this morning.
   */
  const open = await db.timeEntry.findFirst({
    where: { userId, endedAt: null },
    select: { id: true, jobId: true, job: { select: { number: true, title: true } } },
  });

  if (open) {
    if (open.jobId === jobId) {
      // The same tap arriving twice on a bad connection. Not an error.
      const entry = await db.timeEntry.findUniqueOrThrow({
        where: { id: open.id },
        select: ENTRY_SELECT,
      });
      return { entry, changed: false, proximity: proximityOfStart(entry, job.property) };
    }

    throw conflict(
      `You are still clocked in on ${open.job.number} (${open.job.title}). Clock out of that first.`,
    );
  }

  const entry = await db.timeEntry.create({
    data: {
      organizationId,
      jobId,
      userId,
      startedAt: new Date(),
      startLatitude: input.latitude ?? null,
      startLongitude: input.longitude ?? null,
      startAccuracyMetres: input.accuracyMetres ?? null,
      startLocationNote: input.locationNote ?? null,
      note: input.note ?? null,
    },
    select: ENTRY_SELECT,
  });

  /*
   * The job moves with the first person on site. `startJob` is idempotent and
   * refuses illegal transitions itself, so a second crew member arriving an hour
   * later changes nothing — and the job's own startedAt keeps meaning "when work
   * began", not "when the last person turned up".
   */
  if (job.status === JobStatus.SCHEDULED || job.status === JobStatus.CONFIRMED) {
    await startJob(db, jobId);
  }

  return { entry, changed: true, proximity: proximityOfStart(entry, job.property) };
}

export type ClockOutResult = {
  entry: TimeEntryRow;
  minutes: number | null;
  changed: boolean;
  proximity: Proximity;
};

/**
 * Stopping the clock.
 *
 * Deliberately does not finish the job. Completing is the irreversible one — it
 * moves the customer's lifetime value and sets the review request going — and a
 * crew member packing the truck is not the person deciding the job is done. The
 * two are separate taps because they are separate decisions.
 */
export async function clockOut(
  db: TenantClient,
  jobId: string,
  userId: string,
  input: ClockOutInput = {},
): Promise<ClockOutResult> {
  const job = await requireLiveJob(db, jobId);

  const open = await db.timeEntry.findFirst({
    where: { jobId, userId, endedAt: null },
    select: { id: true, startedAt: true },
  });

  if (!open) {
    const recent = await db.timeEntry.findFirst({
      where: { jobId, userId },
      orderBy: { endedAt: 'desc' },
      select: ENTRY_SELECT,
    });

    // Already clocked out — the second half of the same double tap.
    if (recent?.endedAt) {
      return {
        entry: recent,
        minutes: entryMinutes(recent),
        changed: false,
        proximity: proximityOfEnd(recent, job.property),
      };
    }

    throw conflict('You are not clocked in on this job.');
  }

  const now = new Date();

  /*
   * Conditional on the entry still being open, for the same reason starting a
   * job is: two taps that race would otherwise both write an end time, and the
   * later one would silently extend a shift that had already been closed.
   */
  const closed = await db.timeEntry.updateMany({
    where: { id: open.id, endedAt: null },
    data: {
      endedAt: now,
      endLatitude: input.latitude ?? null,
      endLongitude: input.longitude ?? null,
      endAccuracyMetres: input.accuracyMetres ?? null,
      endLocationNote: input.locationNote ?? null,
      ...(input.note ? { note: input.note } : {}),
    },
  });

  const entry = await db.timeEntry.findUniqueOrThrow({
    where: { id: open.id },
    select: ENTRY_SELECT,
  });

  /*
   * And the product stops knowing where they are.
   *
   * Clocking out is the end of the working day as far as this is concerned, so
   * the live position goes with it. Here rather than on a timer, because "we
   * delete it eventually" and "it is gone the moment you finish" are different
   * promises, and only one of them is easy to keep.
   */
  await forgetPosition(db, userId);

  return {
    entry,
    minutes: entryMinutes(entry),
    changed: closed.count > 0,
    proximity: proximityOfEnd(entry, job.property),
  };
}

type PropertyPoint = { latitude: number | null; longitude: number | null } | null;

export function proximityOfStart(entry: TimeEntryRow, property: PropertyPoint): Proximity {
  return describeProximity({
    pin: {
      latitude: entry.startLatitude,
      longitude: entry.startLongitude,
      accuracyMetres: entry.startAccuracyMetres,
    },
    property: property ?? { latitude: null, longitude: null },
  });
}

export function proximityOfEnd(entry: TimeEntryRow, property: PropertyPoint): Proximity {
  return describeProximity({
    pin: {
      latitude: entry.endLatitude,
      longitude: entry.endLongitude,
      accuracyMetres: entry.endAccuracyMetres,
    },
    property: property ?? { latitude: null, longitude: null },
  });
}

export type JobTimeSheet = {
  entries: TimeEntryRow[];
  /** The viewer's own open entry on this job, if they have one. */
  mine: TimeEntryRow | null;
  /** Closed minutes, summed across everyone. Open entries are not counted. */
  totalMinutes: number;
  /** True when somebody is still on the clock here. */
  anyOpen: boolean;
  /** True when an open entry has run past the point of looking like a mistake. */
  anyForgotten: boolean;
};

export async function jobTimeSheet(
  db: TenantClient,
  jobId: string,
  viewerUserId: string,
): Promise<JobTimeSheet> {
  const entries = await db.timeEntry.findMany({
    where: { jobId },
    select: ENTRY_SELECT,
    orderBy: { startedAt: 'asc' },
  });

  let totalMinutes = 0;
  for (const entry of entries) totalMinutes += entryMinutes(entry) ?? 0;

  return {
    entries,
    mine: entries.find((entry) => entry.userId === viewerUserId && !entry.endedAt) ?? null,
    totalMinutes,
    anyOpen: entries.some((entry) => !entry.endedAt),
    anyForgotten: entries.some((entry) => looksForgotten(entry)),
  };
}

/**
 * Who worked this job and for how long, for costing it.
 *
 * Open entries are left out rather than counted up to now. A running clock is
 * not a cost yet, and a cost view that grew while you watched it would be
 * reporting the time of day as much as the job.
 */
export async function workedMinutesByPerson(
  db: TenantClient,
  jobId: string,
): Promise<{ userId: string; minutes: number }[]> {
  const entries = await db.timeEntry.findMany({
    where: { jobId, endedAt: { not: null } },
    select: { userId: true, startedAt: true, endedAt: true },
  });

  const byPerson = new Map<string, number>();

  for (const entry of entries) {
    const minutes = entryMinutes(entry);
    if (minutes === null) continue;
    byPerson.set(entry.userId, (byPerson.get(entry.userId) ?? 0) + minutes);
  }

  return [...byPerson].map(([userId, minutes]) => ({ userId, minutes }));
}
