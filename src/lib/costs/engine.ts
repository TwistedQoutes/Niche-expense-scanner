/**
 * What a job cost, and therefore what it actually made.
 *
 * The pricing engine answers "what should we charge?". This answers the question
 * an owner asks at the end of the week, which is a different one: *was that job
 * worth doing?* A business can be busy, fully booked and quietly losing money on
 * every third job, and the only way to know is to put the cost of the hours and
 * the miles next to the price on the invoice.
 *
 * Pure, and deliberately so — the same reason the pricing engine is. Given the
 * same numbers it returns the same answer, on a server or in a test, with no
 * clock and no database.
 *
 * **The rule that matters here is what happens when a number is missing.**
 * Nobody has set a pay rate yet; the truck's economy has never been entered; a
 * job was completed without ever being started, so nothing recorded how long it
 * took. The tempting thing is to treat each of those as zero and show a profit.
 * That is a lie in the direction that loses money: unpriced hours counted as
 * free make every job look good. So a missing input is *named* instead, the
 * total is marked incomplete, and the screen says which part it could not work
 * out. A number you cannot trust is worse than no number, because you act on it.
 */

/** Minutes of work, and what the person doing it is paid. */
export type LabourInput = {
  /** Null when the job was never started, or never finished. */
  workedMinutes: number | null;
  /**
   * One-way drive time to the property, doubled inside. Null when unmeasured.
   *
   * Counted as labour, because it is: the crew is paid for the hour they spend
   * in the truck the same as the hour they spend behind a mower. Leaving it out
   * was the difference between "that forty-minute-away mow makes $17" and the
   * truth, which is that it loses money — and that job is the entire reason an
   * owner wants this screen.
   */
  driveMinutes: number | null;
  /** Null when nobody has set a rate for whoever did the work. */
  hourlyRateCents: number | null;
};

export type JobCostInput = {
  /** What the customer is being charged. */
  priceCents: number;
  labour: LabourInput;
  /** Road miles to the property and back. Null when never measured. */
  driveMiles: number | null;
  /** Pump price per gallon, null until the workspace sets it. */
  fuelPricePerGallonCents: number | null;
  /** Economy in thousandths of a mile per gallon: 18500 is 18.5 mpg. */
  vehicleMpgMilli: number | null;
  /** Anything bought for this job specifically. */
  materialsCents?: number;
};

/** Which part of the cost could not be worked out, and what to do about it. */
export type MissingCost = {
  part: 'labour' | 'travel' | 'fuel';
  /** Said to the owner, naming the thing they would have to fill in. */
  reason: string;
};

export type JobCost = {
  /** Paid time on the property. */
  labourCents: number;
  /** Paid time in the truck, there and back. */
  travelLabourCents: number;
  fuelCents: number;
  materialsCents: number;
  totalCostCents: number;
  profitCents: number;
  /** Profit as a share of the price, in basis points. Null when the price is 0. */
  marginBps: number | null;
  /** Empty when every part of the cost is known. */
  missing: MissingCost[];
  /** False when anything is missing: the total is a floor, not the answer. */
  complete: boolean;
};

/** Round half away from zero, the way money is rounded on paper. */
function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * The cost of the hours.
 *
 * Minutes rather than hours all the way through, because a two-and-a-half hour
 * job is 150 minutes exactly and 2.5 hours only approximately.
 */
export function labourCost(input: LabourInput): { cents: number; missing: MissingCost | null } {
  if (input.hourlyRateCents === null || input.hourlyRateCents <= 0) {
    return {
      cents: 0,
      missing: {
        part: 'labour',
        reason: 'No pay rate is set for whoever did this job, so the hours are not costed.',
      },
    };
  }

  if (input.workedMinutes === null || input.workedMinutes <= 0) {
    return {
      cents: 0,
      missing: {
        part: 'labour',
        reason: 'Nothing recorded how long this took — start and complete the job to count the hours.',
      },
    };
  }

  return { cents: roundCents((input.workedMinutes / 60) * input.hourlyRateCents), missing: null };
}

/**
 * The cost of getting there and back.
 *
 * Doubled, like the fuel: the truck does not come home empty of wages either.
 */
export function travelLabourCost(input: LabourInput): { cents: number; missing: MissingCost | null } {
  if (input.hourlyRateCents === null || input.hourlyRateCents <= 0) {
    // The on-site half already said so; saying it twice on one screen is noise.
    return { cents: 0, missing: null };
  }

  if (input.driveMinutes === null || input.driveMinutes <= 0) {
    return {
      cents: 0,
      missing: {
        part: 'travel',
        reason: 'The drive to this property has not been measured, so the time in the truck is not costed.',
      },
    };
  }

  return { cents: roundCents(((input.driveMinutes * 2) / 60) * input.hourlyRateCents), missing: null };
}

/**
 * The cost of the driving.
 *
 * Miles there and back, not one way. A quote's travel line is about the distance
 * to the job; the fuel bill is about the round trip, and the truck does not get
 * home for free.
 */
export function fuelCost(input: {
  driveMiles: number | null;
  fuelPricePerGallonCents: number | null;
  vehicleMpgMilli: number | null;
}): { cents: number; missing: MissingCost | null } {
  if (input.driveMiles === null || input.driveMiles <= 0) {
    return {
      cents: 0,
      missing: { part: 'fuel', reason: 'The drive to this property has not been measured.' },
    };
  }

  if (!input.fuelPricePerGallonCents || !input.vehicleMpgMilli) {
    return {
      cents: 0,
      missing: {
        part: 'fuel',
        reason: 'Set your fuel price and the truck’s miles per gallon in Settings to count fuel.',
      },
    };
  }

  const roundTripMiles = input.driveMiles * 2;
  const gallons = roundTripMiles / (input.vehicleMpgMilli / 1000);

  return { cents: roundCents(gallons * input.fuelPricePerGallonCents), missing: null };
}

/**
 * Everything together: what went out, what came in, and the gap.
 *
 * The gap is the number this whole feature exists for. An owner who can see it
 * per job can tell the difference between the customer who is worth keeping and
 * the one who is forty minutes away for a fifty dollar mow.
 */
export function calculateJobCost(input: JobCostInput): JobCost {
  const labour = labourCost(input.labour);
  const travel = travelLabourCost(input.labour);
  const fuel = fuelCost(input);
  const materialsCents = Math.max(0, input.materialsCents ?? 0);

  const missing = [labour.missing, travel.missing, fuel.missing].filter(
    (entry): entry is MissingCost => entry !== null,
  );

  const totalCostCents = labour.cents + travel.cents + fuel.cents + materialsCents;
  const profitCents = input.priceCents - totalCostCents;

  return {
    labourCents: labour.cents,
    travelLabourCents: travel.cents,
    fuelCents: fuel.cents,
    materialsCents,
    totalCostCents,
    profitCents,
    /*
     * Margin against the price, not against cost — "we keep 40% of what we
     * charge" is the sentence an owner thinks in, and it is the one comparable
     * to the profit margin the pricing engine works to.
     */
    marginBps:
      input.priceCents > 0 ? Math.round((profitCents / input.priceCents) * 10_000) : null,
    missing,
    complete: missing.length === 0,
  };
}

/**
 * How long a job took, from the two timestamps a job already carries.
 *
 * Null unless both ends exist: a job that was started and never completed has no
 * duration yet, and one marked complete without ever being started has no
 * beginning to measure from. Guessing either way would invent hours nobody
 * worked.
 *
 * Negative durations — a completion timestamp before the start, which an edit
 * can produce — come back null rather than negative. Time that ran backwards is
 * a data problem to notice, not an hour to subtract from the bill.
 */
export function workedMinutes(job: {
  startedAt: Date | null;
  completedAt: Date | null;
}): number | null {
  if (!job.startedAt || !job.completedAt) return null;

  const minutes = (job.completedAt.getTime() - job.startedAt.getTime()) / 60_000;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  return Math.round(minutes);
}
