import { Role } from '@prisma/client';

import { conflict } from '@/lib/api/errors';
import type { TenantClient } from '@/lib/db/tenant';
import { describeProximity, isPlausiblePoint, type Point, type Proximity } from '@/lib/geo/distance';

/**
 * Where the crew are, while they are working.
 *
 * This exists to answer one question, asked by a customer on the phone: *when
 * will they get here?* Everything about it is cut to that question and no wider,
 * because the wider version — a map that knows where your employees are all day
 * — is a different product with different consequences, and it is one
 * accidental schema change away at all times.
 *
 * Three boundaries hold it in place, and none of them is a policy somebody has
 * to remember:
 *
 *  1. **Clocked in, or nothing.** `recordPosition` refuses a position from
 *     anybody without an open time entry. Outside working hours the product does
 *     not know where anyone is — not because it declines to look, but because it
 *     was never told.
 *  2. **The latest only.** One row per person, upserted. There is no trail to
 *     read back, so "where were they on Thursday" has no answer here.
 *  3. **Gone at the end of the day.** Clocking out deletes the row.
 *
 * The fourth safeguard is not in this file at all: the crew member's own screen
 * shows that their position is being shared and when it last went. Location
 * collected invisibly is a different thing from location shared knowingly.
 */

/**
 * After this long, a position is history rather than news.
 *
 * Twelve minutes is about as stale as "where are they now" can bear before it
 * misleads somebody deciding what to tell a customer. Older than this is still
 * shown — knowing where they were twenty minutes ago is useful — but it is
 * labelled, never presented as current.
 */
export const STALE_AFTER_MINUTES = 12;

export function isStale(recordedAt: Date, now = new Date()): boolean {
  return now.getTime() - recordedAt.getTime() > STALE_AFTER_MINUTES * 60_000;
}

/**
 * Who may look at where the crew are.
 *
 * Owners and admins, the same line as pay and as the clock-in pins. A crew
 * member can always see their own, which is the point of showing it to them.
 */
export function maySeeCrewPositions(role: Role): boolean {
  return role === Role.OWNER || role === Role.ADMIN;
}

export type PositionInput = {
  latitude: number;
  longitude: number;
  accuracyMetres?: number;
  /** When the phone took the reading, if it said. */
  recordedAt?: Date;
};

/**
 * Accepting a position, if the sender is working.
 *
 * The open-time-entry check is the whole boundary, so it is made here against
 * the database rather than trusted from a client that claims to be clocked in.
 */
export async function recordPosition(
  db: TenantClient,
  organizationId: string,
  userId: string,
  input: PositionInput,
): Promise<{ recordedAt: Date; jobId: string | null }> {
  const open = await db.timeEntry.findFirst({
    where: { userId, endedAt: null },
    select: { jobId: true },
  });

  if (!open) {
    throw conflict('You are not clocked in, so your location is not being shared.');
  }

  /*
   * A reading from the future, or from last week, is a broken device clock.
   * Clamped to now rather than rejected: the position is probably fine and only
   * the timestamp is wrong, and refusing it would make one person invisible on
   * the map because their phone lost track of the date.
   */
  const now = new Date();
  const claimed = input.recordedAt ?? now;
  const recordedAt =
    claimed > now || now.getTime() - claimed.getTime() > 60 * 60_000 ? now : claimed;

  await db.crewPosition.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: {
      organizationId,
      userId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMetres: input.accuracyMetres ?? null,
      jobId: open.jobId,
      recordedAt,
    },
    update: {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMetres: input.accuracyMetres ?? null,
      jobId: open.jobId,
      recordedAt,
    },
  });

  return { recordedAt, jobId: open.jobId };
}

/**
 * Forgetting where somebody is.
 *
 * Called when they clock out, and available on its own so a crew member can stop
 * sharing without stopping work. A delete rather than a flag: a row that still
 * holds coordinates but is marked "not sharing" is a row somebody can read.
 */
export async function forgetPosition(db: TenantClient, userId: string): Promise<void> {
  await db.crewPosition.deleteMany({ where: { userId } });
}

export type CrewWhereabouts = {
  userId: string;
  name: string;
  recordedAt: Date;
  stale: boolean;
  accuracyMetres: number | null;
  jobId: string | null;
  jobTitle: string | null;
  jobNumber: string | null;
  /** How they are placed against the job they are clocked into. */
  atJob: Proximity;
  /** And against the yard. */
  fromBase: Proximity;
};

/**
 * Everyone currently sharing a position.
 *
 * Each one comes back as what can honestly be said about them, through the same
 * `describeProximity` that governs the clock-in pins — so a fix the phone was
 * unsure about reads as "too vague to place" here too, rather than as a
 * confident dot on a map.
 */
export async function crewWhereabouts(
  db: TenantClient,
  base: Point | null,
  now = new Date(),
): Promise<CrewWhereabouts[]> {
  const positions = await db.crewPosition.findMany({
    select: {
      userId: true,
      latitude: true,
      longitude: true,
      accuracyMetres: true,
      jobId: true,
      recordedAt: true,
      user: { select: { name: true } },
    },
    orderBy: { recordedAt: 'desc' },
  });

  if (positions.length === 0) return [];

  const jobIds = [...new Set(positions.map((row) => row.jobId).filter((id): id is string => !!id))];

  const jobs =
    jobIds.length > 0
      ? await db.job.findMany({
          where: { id: { in: jobIds } },
          select: {
            id: true,
            number: true,
            title: true,
            property: { select: { latitude: true, longitude: true } },
          },
        })
      : [];

  const jobById = new Map(jobs.map((job) => [job.id, job]));

  return positions.map((row) => {
    const job = row.jobId ? jobById.get(row.jobId) : undefined;
    const pin = {
      latitude: row.latitude,
      longitude: row.longitude,
      accuracyMetres: row.accuracyMetres,
    };

    return {
      userId: row.userId,
      name: row.user.name ?? 'A teammate',
      recordedAt: row.recordedAt,
      stale: isStale(row.recordedAt, now),
      accuracyMetres: row.accuracyMetres,
      jobId: job?.id ?? null,
      jobTitle: job?.title ?? null,
      jobNumber: job?.number ?? null,
      atJob: describeProximity({
        pin,
        property: job?.property ?? { latitude: null, longitude: null },
      }),
      fromBase: describeProximity({
        pin,
        property: base && isPlausiblePoint(base) ? base : { latitude: null, longitude: null },
      }),
    };
  });
}
