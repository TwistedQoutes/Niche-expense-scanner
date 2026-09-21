import { metresBetween, type Point } from '@/lib/geo/distance';

/**
 * Putting a day's stops in a sensible order.
 *
 * The problem is the travelling salesman, and the honest thing to say about it
 * up front is that this does not solve it. It gets a good answer quickly, which
 * for a lawn crew with eleven gardens is the same thing: the difference between
 * a good route and the provably optimal one is a couple of minutes, and the
 * difference between a good route and the order the jobs happened to be booked
 * in is often an hour.
 *
 * **Distances here are straight lines, not roads.** That is a real limitation
 * and it is stated everywhere this is shown, because a number labelled "miles"
 * that is not road miles is the kind of thing an owner would plan a day around.
 * A river, a railway or a one-way system can make two gardens that are 400 yards
 * apart a ten-minute drive. What straight-line distance is reliably good at is
 * *ordering* — the nearest garden as the crow flies is almost always the nearest
 * one to drive to in a town — and ordering is what this produces. The mileage
 * beside it is an estimate, and the honest use of it is comparing one order
 * against another rather than reading it as a distance.
 *
 * Road distances would need a call to Google per pair of stops, which costs
 * money on every recalculation and would make the feature unavailable to anybody
 * who has not configured Maps. That trade is not worth it for a number that
 * mostly serves as a comparison.
 */

export type Stop = { id: string } & Point;

export type RouteLeg = {
  /** Null when the leg starts at the shop. */
  fromId: string | null;
  /** Null when the leg ends back at the shop. */
  toId: string | null;
  metres: number;
};

export type RoutePlan = {
  /** Stop ids, in the order to visit them. */
  order: string[];
  legs: RouteLeg[];
  /** The whole round trip, shop to shop. */
  totalMetres: number;
};

/**
 * How far a given order actually is, out and back.
 *
 * The return leg counts. A route that ends at the far edge of town looks cheap
 * until somebody has to drive home from it, and leaving it out would reliably
 * recommend exactly those routes.
 */
export function routeLength(base: Point, stops: Stop[]): number {
  if (stops.length === 0) return 0;

  let total = metresBetween(base, stops[0]!);

  for (let index = 1; index < stops.length; index += 1) {
    total += metresBetween(stops[index - 1]!, stops[index]!);
  }

  return total + metresBetween(stops.at(-1)!, base);
}

/**
 * The obvious first pass: from wherever you are, go to the nearest one left.
 *
 * Gets within about 25% of optimal on its own, and is what most people do in
 * their head. The pass after it is what earns the rest.
 *
 * Ties break on id rather than on array order, so the same day always produces
 * the same route. A plan that reshuffled itself on every page load would be
 * impossible to trust or to check against.
 */
function nearestNeighbour(base: Point, stops: Stop[]): Stop[] {
  const remaining = [...stops];
  const order: Stop[] = [];
  let here: Point = base;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestMetres = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      const metres = metresBetween(here, candidate);

      if (metres < bestMetres || (metres === bestMetres && candidate.id < remaining[bestIndex]!.id)) {
        bestMetres = metres;
        bestIndex = index;
      }
    }

    here = remaining[bestIndex]!;
    order.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return order;
}

/**
 * How many passes of the improvement step to allow.
 *
 * 2-opt converges in a handful of passes at these sizes; the cap only exists so
 * a pathological input cannot turn a page render into a spin. A day with more
 * stops than any crew could work is not worth a millisecond of anybody's time.
 */
const MAX_PASSES = 40;

/**
 * Untangling the route.
 *
 * Nearest-neighbour has a characteristic failure: it hoovers up the close stops
 * first and leaves one distant straggler, so the route crosses itself getting
 * back. 2-opt fixes exactly that — take any two legs that cross, reverse the
 * stops between them, and the crossing disappears. Repeat until nothing
 * improves.
 *
 * Cheap at these sizes (a day is ten or twenty stops, not a thousand), and it
 * typically takes another 10–15% off the nearest-neighbour answer, which on a
 * rural round is a real half hour.
 */
function twoOpt(base: Point, stops: Stop[]): Stop[] {
  if (stops.length < 4) return stops;

  let best = [...stops];
  let bestLength = routeLength(base, best);

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let improved = false;

    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, k + 1).reverse(),
          ...best.slice(k + 1),
        ];

        const length = routeLength(base, candidate);

        /*
         * A strict improvement, and by more than a metre. Floating point makes
         * "shorter by 0.0000001" achievable in both directions, and accepting
         * those would let the loop swap back and forth until the pass cap.
         */
        if (length < bestLength - 1) {
          best = candidate;
          bestLength = length;
          improved = true;
        }
      }
    }

    if (!improved) break;
  }

  return best;
}

/** The order to drive, and what it costs. */
export function planRoute(base: Point, stops: Stop[]): RoutePlan {
  if (stops.length === 0) {
    return { order: [], legs: [], totalMetres: 0 };
  }

  const ordered = twoOpt(base, nearestNeighbour(base, stops));

  const legs: RouteLeg[] = [];
  let previous: Point = base;
  let previousId: string | null = null;

  for (const stop of ordered) {
    legs.push({ fromId: previousId, toId: stop.id, metres: metresBetween(previous, stop) });
    previous = stop;
    previousId = stop.id;
  }

  // Home again, which is a leg like any other and the one most easily forgotten.
  legs.push({ fromId: previousId, toId: null, metres: metresBetween(previous, base) });

  return {
    order: ordered.map((stop) => stop.id),
    legs,
    totalMetres: legs.reduce((total, leg) => total + leg.metres, 0),
  };
}

/**
 * What reordering would save, against the order the day is currently in.
 *
 * Expressed as a comparison rather than as an absolute, because both figures
 * come from straight lines: the difference between two estimates made the same
 * way is meaningful even when neither is a road distance. "About a fifth
 * shorter" survives the approximation in a way that "23.4 miles" does not.
 */
export function compareToCurrent(
  base: Point,
  currentOrder: Stop[],
): { current: number; planned: number; savedMetres: number; savedFraction: number } {
  const current = routeLength(base, currentOrder);
  const planned = routeLength(
    base,
    planRoute(base, currentOrder).order.map(
      (id) => currentOrder.find((stop) => stop.id === id)!,
    ),
  );

  const savedMetres = Math.max(0, current - planned);

  return {
    current,
    planned,
    savedMetres,
    savedFraction: current > 0 ? savedMetres / current : 0,
  };
}
