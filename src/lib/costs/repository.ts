import { Role } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import type { TenantClient } from '@/lib/db/tenant';
import { calculateJobCost, workedMinutes, type JobCost, type LabourInput } from '@/lib/costs/engine';
import { workedMinutesByPerson } from '@/lib/time/repository';

/**
 * Gathering the four numbers a job's cost is made of.
 *
 * Deliberately its own read rather than a wider `JOB_SELECT`: pay rates are the
 * most sensitive column in the schema, and a list query that happened to carry
 * them would eventually be rendered somewhere it should not be. Costing a job is
 * a separate question asked by a separate screen, so it gets a separate query
 * that pulls pay only when somebody with the standing to see it has asked.
 *
 * The caller is responsible for that standing — see `maySeeJobCosts`.
 */

/**
 * Who may see what a job cost.
 *
 * Owners and admins. Not crew, and the reason is not secrecy about margins: a
 * job's labour line is one person's hourly pay multiplied by the hours, so
 * showing it to a colleague is showing them that colleague's wage. The clean
 * line is the same one the team screen draws.
 */
export function maySeeJobCosts(role: Role): boolean {
  return role === Role.OWNER || role === Role.ADMIN;
}

export async function jobCost(
  db: TenantClient,
  organizationId: string,
  jobId: string,
): Promise<JobCost | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      priceCents: true,
      startedAt: true,
      completedAt: true,
      assignedUserId: true,
      property: {
        select: { driveMilesFromBase: true, driveMinutesFromBase: true },
      },
    },
  });

  if (!job) return null;

  const [clocked, organization] = await Promise.all([
    workedMinutesByPerson(db, jobId),
    // Organization is the tenant itself, so it is read through the unscoped
    // client with the id from the verified session.
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { fuelPricePerGallonCents: true, vehicleMpgMilli: true },
    }),
  ]);

  const driveMinutes = job.property?.driveMinutesFromBase ?? null;

  /*
   * Who to cost, and at whose rate.
   *
   * The clock is the better answer when there is one: it knows that two people
   * were there, that one of them left at noon, and who each of them is — so each
   * person's hours meet their own pay rate. The job's own start and finish
   * timestamps are the fallback for work done before anybody clocked in, or on a
   * business that never uses the clock at all, and they can only describe one
   * person: the assignee, for the whole span.
   *
   * Both paths feed the same arithmetic. Neither invents an hour that was not
   * recorded.
   */
  const crew: LabourInput[] =
    clocked.length > 0
      ? await costClockedCrew(db, clocked, driveMinutes)
      : [await costAssignee(db, job.assignedUserId, workedMinutes(job), driveMinutes)];

  return calculateJobCost({
    priceCents: job.priceCents,
    crew,
    driveMiles: job.property?.driveMilesFromBase ?? null,
    fuelPricePerGallonCents: organization?.fuelPricePerGallonCents ?? null,
    vehicleMpgMilli: organization?.vehicleMpgMilli ?? null,
  });
}

/**
 * Each person who clocked in, at their own rate.
 *
 * The drive is counted once per person rather than once per job, because it is
 * labour and everybody in the truck is being paid for it. Two crew on a
 * twenty-minute drive is eighty paid minutes of travel, there and back, and a
 * version that counted it once would understate exactly the jobs this feature
 * exists to find.
 */
async function costClockedCrew(
  db: TenantClient,
  clocked: { userId: string; minutes: number }[],
  driveMinutes: number | null,
): Promise<LabourInput[]> {
  const memberships = await db.membership.findMany({
    where: { userId: { in: clocked.map((person) => person.userId) } },
    select: { userId: true, hourlyRateCents: true },
  });

  const rates = new Map(memberships.map((row) => [row.userId, row.hourlyRateCents]));

  return clocked.map((person) => ({
    workedMinutes: person.minutes,
    driveMinutes,
    hourlyRateCents: rates.get(person.userId) ?? null,
  }));
}

/** The old shape: one span, one person, for jobs the clock never touched. */
async function costAssignee(
  db: TenantClient,
  assignedUserId: string | null,
  minutes: number | null,
  driveMinutes: number | null,
): Promise<LabourInput> {
  /*
   * The rate belongs to the membership, so an unassigned job has no labour cost
   * to work out — which the engine reports as a missing part rather than as free
   * work.
   */
  const assignee = assignedUserId
    ? await db.membership.findFirst({
        where: { userId: assignedUserId },
        select: { hourlyRateCents: true },
      })
    : null;

  return {
    workedMinutes: minutes,
    driveMinutes,
    hourlyRateCents: assignee?.hourlyRateCents ?? null,
  };
}
