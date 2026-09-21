import { describe, expect, it } from 'vitest';

import { compareToCurrent, planRoute, routeLength, type Stop } from '@/lib/routing/plan';

/**
 * Ordering a day's stops.
 *
 * Built on geometry that is easy to check by hand: a grid of points where the
 * right answer is obvious to a human, so a test failing means the algorithm is
 * wrong rather than that the fixture was too clever.
 *
 * One degree of latitude is about 111 km, so these coordinates are laid out in
 * hundredths of a degree — roughly a kilometre apart, which is the scale a lawn
 * round actually works at.
 */

const BASE = { latitude: 30.0, longitude: -97.0 };

/** A stop `north` and `east` kilometres-ish from the shop. */
const at = (id: string, north: number, east: number): Stop => ({
  id,
  latitude: 30.0 + north * 0.009,
  longitude: -97.0 + east * 0.0104,
});

describe('how long a route is', () => {
  it('is nothing when there is nowhere to go', () => {
    expect(routeLength(BASE, [])).toBe(0);
  });

  it('counts the drive home', () => {
    /*
     * The leg most easily forgotten, and leaving it out does not just make the
     * number small — it makes the algorithm prefer routes that end at the far
     * edge of town, because getting back is free.
     */
    const there = routeLength(BASE, [at('a', 5, 0)]);

    // Out and back, so twice the one-way distance — about 5 km each way.
    expect(there).toBeGreaterThan(9_000);
    expect(there).toBeLessThan(11_000);
  });

  it('grows when stops are visited in a sillier order', () => {
    /*
     * Three stops, not two. A round trip to two stops is the same cycle
     * whichever way round it is driven, so the order genuinely does not matter
     * until there are three — which is worth knowing before reading a saving of
     * zero on a two-job day as a bug.
     */
    const near = at('near', 1, 0);
    const middle = at('middle', 5, 0);
    const far = at('far', 9, 0);

    const sensible = routeLength(BASE, [near, middle, far]);
    const silly = routeLength(BASE, [far, near, middle]);

    expect(silly).toBeGreaterThan(sensible);
  });
});

describe('planning the order', () => {
  it('has nothing to say about an empty day', () => {
    expect(planRoute(BASE, [])).toEqual({ order: [], legs: [], totalMetres: 0 });
  });

  it('visits a line of stops in order rather than zig-zagging', () => {
    // Five gardens along one road. Any order but this one doubles back.
    const stops = [at('e', 5, 0), at('b', 2, 0), at('d', 4, 0), at('a', 1, 0), at('c', 3, 0)];

    expect(planRoute(BASE, stops).order).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('starts from the shop, not from the first job on the list', () => {
    // The nearest stop to the shop leads, whatever order they were booked in.
    const stops = [at('far', 8, 0), at('near', 1, 0), at('middle', 4, 0)];

    expect(planRoute(BASE, stops).order[0]).toBe('near');
  });

  it('returns a leg for every hop including the way home', () => {
    const plan = planRoute(BASE, [at('a', 1, 0), at('b', 2, 0)]);

    // Shop → a → b → shop.
    expect(plan.legs).toHaveLength(3);
    expect(plan.legs[0]!.fromId).toBeNull();
    expect(plan.legs.at(-1)!.toId).toBeNull();
    expect(plan.totalMetres).toBeCloseTo(
      plan.legs.reduce((sum, leg) => sum + leg.metres, 0),
      6,
    );
  });

  it('gives the same answer twice for the same day', () => {
    /*
     * Determinism is not fussiness here. A plan that reshuffled itself between
     * page loads could not be checked against, and an owner who printed it in
     * the morning would be holding a different route from the one on the screen.
     */
    const stops = [at('a', 1, 1), at('b', 1, 1), at('c', 3, 2), at('d', 2, 4)];

    expect(planRoute(BASE, stops).order).toEqual(planRoute(BASE, [...stops].reverse()).order);
  });
});

/**
 * Every possible order, for days small enough to enumerate.
 *
 * Only usable up to about eight stops — 8! is 40,320 and 12! is half a billion —
 * which is exactly why the planner does not work this way. But on a five-stop
 * day it gives the tests something better than "shorter than before" to check
 * against: the actual answer.
 */
function shortestPossible(base: typeof BASE, stops: Stop[]): number {
  function* orders(rest: Stop[]): Generator<Stop[]> {
    if (rest.length <= 1) {
      yield rest;
      return;
    }

    for (let index = 0; index < rest.length; index += 1) {
      const without = [...rest.slice(0, index), ...rest.slice(index + 1)];
      for (const tail of orders(without)) yield [rest[index]!, ...tail];
    }
  }

  let shortest = Number.POSITIVE_INFINITY;
  for (const order of orders(stops)) shortest = Math.min(shortest, routeLength(base, order));

  return shortest;
}

describe('untangling a route that crosses itself', () => {
  it('beats the greedy order on the case greedy is bad at', () => {
    /*
     * Nearest-neighbour's characteristic failure: it takes the cheap stops first
     * and leaves a straggler, so the route crosses itself getting home. This
     * layout — a tight cluster near the shop and one garden out on its own — is
     * the shape that produces it, and 2-opt exists to fix exactly this.
     */
    const stops = [
      at('cluster-1', 1, 0),
      at('cluster-2', 1, 1),
      at('cluster-3', 2, 1),
      at('cluster-4', 2, 0),
      at('outlier', 9, 9),
    ];

    const plan = planRoute(BASE, stops);

    expect(plan.totalMetres).toBeLessThan(routeLength(BASE, stops));

    /*
     * And it is not merely better — on this day it is the best there is,
     * checked against every possible order rather than against an intuition
     * about where the outlier ought to go. (It goes in the middle: the route is
     * a loop, and one of the cluster gardens is on the way home from it. The
     * obvious guess that a distant stop must come first or last is wrong, which
     * is rather the point of checking.)
     */
    expect(plan.totalMetres).toBeCloseTo(shortestPossible(BASE, stops), 6);
  });

  it('never returns a route longer than the one it was given', () => {
    /*
     * The property that matters most in practice. A suggestion that is worse
     * than what the owner already had is worse than no suggestion: it costs
     * their trust the first time they check it.
     */
    const days: Stop[][] = [
      [at('a', 1, 5), at('b', 7, 2), at('c', 3, 3), at('d', 9, 8), at('e', 2, 9)],
      [at('a', 5, 5), at('b', 5, 5), at('c', 1, 9), at('d', 9, 1)],
      [at('a', 1, 1), at('b', 2, 2), at('c', 3, 3), at('d', 4, 4), at('e', 5, 5), at('f', 6, 6)],
    ];

    for (const stops of days) {
      const plan = planRoute(BASE, stops);
      expect(plan.totalMetres).toBeLessThanOrEqual(routeLength(BASE, stops) + 1);
    }
  });
});

describe('what reordering would save', () => {
  it('reports a saving on a badly ordered day', () => {
    // Booked in the order the phone rang: across town, back, across again.
    const booked = [at('far', 9, 9), at('near', 1, 1), at('middle', 5, 5)];

    const comparison = compareToCurrent(BASE, booked);

    expect(comparison.savedMetres).toBeGreaterThan(0);
    expect(comparison.savedFraction).toBeGreaterThan(0.1);
    expect(comparison.planned).toBeLessThan(comparison.current);
  });

  it('promises nothing on a day that is already in the right order', () => {
    // No invented saving to justify the feature's existence. If the owner's own
    // order is good, the honest answer is that there is nothing to do.
    const alreadyGood = [at('a', 1, 0), at('b', 2, 0), at('c', 3, 0)];

    const comparison = compareToCurrent(BASE, alreadyGood);

    expect(comparison.savedMetres).toBe(0);
    expect(comparison.savedFraction).toBe(0);
  });

  it('never reports a negative saving', () => {
    const comparison = compareToCurrent(BASE, [at('a', 1, 0)]);

    expect(comparison.savedMetres).toBeGreaterThanOrEqual(0);
  });
});

describe('how good the answer is, across a lot of days', () => {
  /** A deterministic generator, so a failure can be reproduced exactly. */
  function seeded(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
  }

  it('lands within a few percent of the best possible order', () => {
    /*
     * 2-opt finds a local optimum, not the global one, and this test says how
     * local. Fifty random seven-stop days, each checked against every one of
     * their 5,040 possible orders.
     *
     * The assertion is a bound rather than equality because the honest claim is
     * a bound: this is a good route, quickly, and a crew that saves twenty
     * minutes does not care that a perfect solver would have saved twenty-one.
     * Writing it down as a number means a future change that quietly makes the
     * routes worse fails here instead of on somebody's Tuesday.
     */
    const random = seeded(20260921);
    let worstRatio = 1;

    for (let day = 0; day < 50; day += 1) {
      const stops: Stop[] = Array.from({ length: 7 }, (_, index) =>
        at(`s${index}`, random() * 12, random() * 12),
      );

      const planned = planRoute(BASE, stops).totalMetres;
      const best = shortestPossible(BASE, stops);

      expect(planned).toBeGreaterThanOrEqual(best - 1);
      worstRatio = Math.max(worstRatio, planned / best);
    }

    // Measured at 1.0 on this seed — 2-opt finds the optimum on every one of
    // these days. The headroom is so a slightly unluckier seed is not a failure.
    expect(worstRatio).toBeLessThan(1.05);
  });

  it('never returns something worse than the order it was handed', () => {
    const random = seeded(4242);

    for (let day = 0; day < 50; day += 1) {
      const stops: Stop[] = Array.from({ length: 9 }, (_, index) =>
        at(`s${index}`, random() * 15, random() * 15),
      );

      expect(planRoute(BASE, stops).totalMetres).toBeLessThanOrEqual(routeLength(BASE, stops) + 1);
    }
  });
});
