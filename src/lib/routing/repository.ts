import { AppointmentStatus } from '@prisma/client';

import { notFound, validationFailed } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import type { TenantClient } from '@/lib/db/tenant';
import { localDayRange } from '@/lib/dates';
import { isPlausiblePoint, type Point } from '@/lib/geo/distance';
import { formatAddress, geocodeAddress, mapsEnabled } from '@/lib/maps/client';
import { compareToCurrent, planRoute, routeLength, type Stop } from '@/lib/routing/plan';

/**
 * A day's work, in the order it is booked and in the order it could be.
 *
 * Nothing here moves anything. The plan is a suggestion an owner looks at and
 * chooses to apply, because the thing being reordered is a set of times that
 * customers have been told, and software that quietly rearranged them would be
 * software that makes people miss appointments. Applying is a separate,
 * deliberate act, and it says what it will do before it does it.
 */

export type RouteStop = {
  appointmentId: string;
  jobId: string | null;
  number: string | null;
  title: string;
  customerName: string;
  address: string | null;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  latitude: number | null;
  longitude: number | null;
};

export type DayRoute = {
  date: string;
  /** The shop, if we know where it is. */
  base: Point | null;
  /**
   * True when there is no business address to route from, so the day is ordered
   * relative to whatever is booked first instead. A worse plan than one that
   * knows where the truck starts, and worth saying so rather than pretending.
   */
  startsFromFirstJob: boolean;
  /** Booked order — what the day looks like now. */
  booked: RouteStop[];
  /** The order this suggests, same stops. */
  suggested: RouteStop[];
  /** Stops with no coordinates, which cannot be placed on a route at all. */
  unplaceable: RouteStop[];
  currentMetres: number;
  plannedMetres: number;
  savedMetres: number;
  savedFraction: number;
};

/**
 * Where the business starts its day, geocoded once and kept.
 *
 * The address is on the workspace already; its coordinates were never filled in
 * by anything, so the first route of the day fills them and every route after
 * that reads them. Re-geocoding on every page load would bill the owner for a
 * building that has not moved.
 */
export async function baseLocation(organizationId: string): Promise<Point | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      latitude: true,
      longitude: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
    },
  });

  if (!organization) return null;

  if (isPlausiblePoint(organization)) {
    return { latitude: organization.latitude!, longitude: organization.longitude! };
  }

  if (!mapsEnabled() || !organization.addressLine1) return null;

  const geocoded = await geocodeAddress(formatAddress(organization));
  if (!geocoded) return null;

  await prisma.organization.update({
    where: { id: organizationId },
    data: { latitude: geocoded.latitude, longitude: geocoded.longitude },
  });

  return { latitude: geocoded.latitude, longitude: geocoded.longitude };
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

export async function loadDayRoute(
  db: TenantClient,
  organizationId: string,
  timeZone: string,
  date: string,
): Promise<DayRoute> {
  const range = localDayRange(date, timeZone);
  if (!range) throw validationFailed({ date: 'That is not a date we can read.' });

  const appointments = await db.appointment.findMany({
    where: {
      startsAt: { lt: range.end },
      endsAt: { gt: range.start },
      status: { not: AppointmentStatus.CANCELLED },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      addressLine1: true,
      city: true,
      jobId: true,
      customer: { select: { firstName: true, lastName: true } },
      job: {
        select: {
          id: true,
          number: true,
          property: { select: { latitude: true, longitude: true } },
        },
      },
    },
    orderBy: { startsAt: 'asc' },
  });

  const booked: RouteStop[] = appointments.map((appointment) => ({
    appointmentId: appointment.id,
    jobId: appointment.job?.id ?? null,
    number: appointment.job?.number ?? null,
    title: appointment.title,
    customerName: [appointment.customer?.firstName, appointment.customer?.lastName]
      .filter(Boolean)
      .join(' '),
    address: [appointment.addressLine1, appointment.city].filter(Boolean).join(', ') || null,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    durationMinutes: minutesBetween(appointment.startsAt, appointment.endsAt),
    latitude: appointment.job?.property?.latitude ?? null,
    longitude: appointment.job?.property?.longitude ?? null,
  }));

  /*
   * A stop with no coordinates cannot be ordered against the others, and
   * guessing one from the address without geocoding it would be inventing a
   * location. They are listed separately and left where they are rather than
   * dropped, because a job missing from the day's plan is a job that does not
   * get done.
   */
  const placeable = booked.filter((stop) => isPlausiblePoint(stop));
  const unplaceable = booked.filter((stop) => !isPlausiblePoint(stop));

  const shop = await baseLocation(organizationId);

  /*
   * With no business address there is still something useful to do: hold the
   * first booked job where it is and order the rest from there. The crew starts
   * where they were always going to start, and the tangle after it gets sorted.
   */
  const startsFromFirstJob = shop === null;
  const base: Point | null = shop ?? (placeable[0] ? pointOf(placeable[0]) : null);

  if (!base || placeable.length < 2) {
    return {
      date,
      base: shop,
      startsFromFirstJob,
      booked,
      suggested: placeable,
      unplaceable,
      currentMetres: 0,
      plannedMetres: 0,
      savedMetres: 0,
      savedFraction: 0,
    };
  }

  // When the first job stands in for the shop it is also the first stop, so it
  // is held out of the reordering rather than being asked to route to itself.
  const anchor = startsFromFirstJob ? placeable[0]! : null;
  const movable = startsFromFirstJob ? placeable.slice(1) : placeable;

  const stops: Stop[] = movable.map((stop) => ({ id: stop.appointmentId, ...pointOf(stop) }));

  const plan = planRoute(base, stops);
  const comparison = compareToCurrent(base, stops);

  const byId = new Map(movable.map((stop) => [stop.appointmentId, stop]));
  const suggested = [
    ...(anchor ? [anchor] : []),
    ...plan.order.map((id) => byId.get(id)!),
  ];

  return {
    date,
    base: shop,
    startsFromFirstJob,
    booked,
    suggested,
    unplaceable,
    currentMetres: comparison.current,
    plannedMetres: comparison.planned,
    savedMetres: comparison.savedMetres,
    savedFraction: comparison.savedFraction,
  };
}

function pointOf(stop: RouteStop): Point {
  return { latitude: stop.latitude!, longitude: stop.longitude! };
}

/** Whether a proposed order is actually a different order. */
export function isReordered(booked: RouteStop[], suggested: RouteStop[]): boolean {
  if (booked.length !== suggested.length) return true;
  return booked.some((stop, index) => stop.appointmentId !== suggested[index]?.appointmentId);
}

/**
 * Writing a new order onto the day.
 *
 * Each job keeps its own length and they are packed one after another from
 * whenever the day currently starts, so a two-hour job stays a two-hour job and
 * the crew's morning still begins when it began.
 *
 * Two things this deliberately does not do. It does not tell anybody: a customer
 * who was given a time needs to hear from a person, and a product that silently
 * texted a dozen people a new appointment because somebody pressed a button on a
 * map would be doing real damage. And it does not check for conflicts, because
 * by construction there are none — the jobs are laid end to end in the space
 * they already occupied.
 *
 * It assumes one crew working the day in sequence, which is what a truck is.
 */
export async function applyRouteOrder(
  db: TenantClient,
  timeZone: string,
  date: string,
  orderedAppointmentIds: string[],
): Promise<{ moved: number }> {
  const range = localDayRange(date, timeZone);
  if (!range) throw validationFailed({ date: 'That is not a date we can read.' });

  const appointments = await db.appointment.findMany({
    where: {
      id: { in: orderedAppointmentIds },
      startsAt: { lt: range.end },
      endsAt: { gt: range.start },
      status: { not: AppointmentStatus.CANCELLED },
    },
    select: { id: true, startsAt: true, endsAt: true, jobId: true },
  });

  /*
   * Every id has to be a real appointment on this day. A mismatch means the page
   * was looking at a day that has since changed — somebody cancelled a visit in
   * another tab — and applying a stale order would move jobs onto times that no
   * longer make sense.
   */
  if (appointments.length !== orderedAppointmentIds.length) {
    throw notFound('That day has changed since this plan was worked out. Reload and try again.');
  }

  const byId = new Map(appointments.map((appointment) => [appointment.id, appointment]));

  // The day still starts when it started.
  let cursor = appointments.reduce(
    (earliest, appointment) => (appointment.startsAt < earliest ? appointment.startsAt : earliest),
    appointments[0]!.startsAt,
  );

  const writes: { id: string; startsAt: Date; endsAt: Date; jobId: string | null }[] = [];

  for (const id of orderedAppointmentIds) {
    const appointment = byId.get(id)!;
    const minutes = minutesBetween(appointment.startsAt, appointment.endsAt);

    const startsAt = new Date(cursor);
    const endsAt = new Date(cursor.getTime() + minutes * 60_000);

    writes.push({ id, startsAt, endsAt, jobId: appointment.jobId });
    cursor = endsAt;
  }

  const changed = writes.filter((write) => {
    const before = byId.get(write.id)!;
    return before.startsAt.getTime() !== write.startsAt.getTime();
  });

  /*
   * One transaction. A half-applied reorder is a day with two jobs on the same
   * slot and a gap where the third used to be, which is worse than not having
   * pressed the button.
   */
  await db.$transaction(
    writes.flatMap((write) => [
      db.appointment.update({
        where: { id: write.id },
        data: { startsAt: write.startsAt, endsAt: write.endsAt },
      }),
      // The job carries its own copy of when it is booked, and a calendar that
      // disagreed with the job page would be the sort of inconsistency a crew
      // discovers at a customer's gate.
      ...(write.jobId
        ? [
            db.job.update({
              where: { id: write.jobId },
              data: { scheduledFor: write.startsAt },
            }),
          ]
        : []),
    ]),
  );

  return { moved: changed.length };
}

/** Straight-line metres for a given booked order, for showing a comparison. */
export function lengthOf(base: Point, stops: RouteStop[]): number {
  return routeLength(
    base,
    stops.filter(isPlausiblePoint).map((stop) => ({ id: stop.appointmentId, ...pointOf(stop) })),
  );
}
