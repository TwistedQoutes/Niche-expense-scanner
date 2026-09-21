import { Role } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import type { TenantClient } from '@/lib/db/tenant';
import { calculateJobCost, workedMinutes, type JobCost } from '@/lib/costs/engine';

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

  const [assignee, organization] = await Promise.all([
    /*
     * The rate belongs to the membership, so an unassigned job has no labour
     * cost to work out — which the engine reports as a missing part rather than
     * as free work.
     */
    job.assignedUserId
      ? db.membership.findFirst({
          where: { userId: job.assignedUserId },
          select: { hourlyRateCents: true },
        })
      : null,
    // Organization is the tenant itself, so it is read through the unscoped
    // client with the id from the verified session.
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { fuelPricePerGallonCents: true, vehicleMpgMilli: true },
    }),
  ]);

  return calculateJobCost({
    priceCents: job.priceCents,
    labour: {
      workedMinutes: workedMinutes(job),
      driveMinutes: job.property?.driveMinutesFromBase ?? null,
      hourlyRateCents: assignee?.hourlyRateCents ?? null,
    },
    driveMiles: job.property?.driveMilesFromBase ?? null,
    fuelPricePerGallonCents: organization?.fuelPricePerGallonCents ?? null,
    vehicleMpgMilli: organization?.vehicleMpgMilli ?? null,
  });
}
