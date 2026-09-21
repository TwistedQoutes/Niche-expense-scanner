import type { LabourInput } from '@/lib/costs/engine';

/**
 * Turning "who was there" into "what that cost", without touching a database.
 *
 * Two screens ask this question and they ask it differently. A job page costs
 * one job and can afford a query per lookup; the profit view costs a hundred and
 * cannot — four queries for a hundred jobs, or the page takes a second per job
 * and an owner stops opening it. What the two share is this decision, so it
 * lives here as a pure function and both hand it whatever they have already
 * fetched.
 *
 * The decision itself is about which source of truth to believe.
 */
export function crewLabour(input: {
  /** Closed clock entries for this job, already summed per person. */
  clocked: { userId: string; minutes: number }[];
  /** Who the job is assigned to, for the fallback. */
  assignedUserId: string | null;
  /** The job's own start-to-finish span, for the fallback. */
  jobWorkedMinutes: number | null;
  /** One-way drive time to the property. Everyone in the truck is paid for it. */
  driveMinutes: number | null;
  /** What this workspace pays a given person, or null if nobody has said. */
  rateFor: (userId: string) => number | null;
}): LabourInput[] {
  /*
   * The clock wins when there is one.
   *
   * It knows that two people were there, that one left at noon, and who each of
   * them is — so each person's hours meet their own pay rate. The job's own
   * timestamps can only describe one person for one span, which is the thing
   * that made a two-person job cost the same as a one-person job.
   */
  if (input.clocked.length > 0) {
    return input.clocked.map((person) => ({
      workedMinutes: person.minutes,
      driveMinutes: input.driveMinutes,
      hourlyRateCents: input.rateFor(person.userId),
    }));
  }

  /*
   * Otherwise the old shape: one span, the assignee, whatever rate they are on.
   * This is not a legacy path to be removed — it is what a business that never
   * uses the clock gets, and work done before anybody started clocking in.
   */
  return [
    {
      workedMinutes: input.jobWorkedMinutes,
      driveMinutes: input.driveMinutes,
      hourlyRateCents: input.assignedUserId ? input.rateFor(input.assignedUserId) : null,
    },
  ];
}
