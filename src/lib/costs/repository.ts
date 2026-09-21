import { Role } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import type { TenantClient } from '@/lib/db/tenant';
import { crewLabour } from '@/lib/costs/crew';
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
  /*
   * The rates for everyone involved, in one query.
   *
   * Whoever clocked in, plus the assignee for the fallback path — asked for
   * together rather than one lookup per person, which on a three-person job was
   * three round trips to read three integers.
   */
  const people = new Set(clocked.map((person) => person.userId));
  if (job.assignedUserId) people.add(job.assignedUserId);

  const memberships =
    people.size > 0
      ? await db.membership.findMany({
          where: { userId: { in: [...people] } },
          select: { userId: true, hourlyRateCents: true },
        })
      : [];

  const rates = new Map(memberships.map((row) => [row.userId, row.hourlyRateCents]));

  const crew: LabourInput[] = crewLabour({
    clocked,
    assignedUserId: job.assignedUserId,
    jobWorkedMinutes: workedMinutes(job),
    driveMinutes,
    rateFor: (userId) => rates.get(userId) ?? null,
  });

  return calculateJobCost({
    priceCents: job.priceCents,
    crew,
    driveMiles: job.property?.driveMilesFromBase ?? null,
    fuelPricePerGallonCents: organization?.fuelPricePerGallonCents ?? null,
    vehicleMpgMilli: organization?.vehicleMpgMilli ?? null,
  });
}
