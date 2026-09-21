import { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { STALE_AFTER_MINUTES, isStale, maySeeCrewPositions } from '@/lib/crew/repository';

/**
 * The rules around a live position.
 *
 * Small functions, and the small ones are where a feature like this is kept
 * honest. The large guarantees — one row per person, nothing written unless
 * somebody is clocked in, the row deleted on clock-out — are structural and
 * proved against a real database rather than here.
 */

describe('when a position stops being news', () => {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
  const now = new Date();

  it('is current when it has just arrived', () => {
    expect(isStale(at(2), now)).toBe(false);
  });

  it('goes stale after the stated window', () => {
    expect(isStale(at(STALE_AFTER_MINUTES + 1), now)).toBe(true);
  });

  it('is still current right on the boundary', () => {
    // A position exactly at the limit has not yet passed it, and an off-by-one
    // here would mark a phone reporting punctually as unreliable.
    expect(isStale(at(STALE_AFTER_MINUTES), now)).toBe(false);
  });

  it('treats a reading from the future as current rather than ancient', () => {
    /*
     * A phone with a fast clock. The arithmetic would otherwise be negative,
     * which is not stale by any reading — and the server clamps these on the way
     * in, so this is the second line of defence rather than the first.
     */
    expect(isStale(new Date(now.getTime() + 60_000), now)).toBe(false);
  });
});

describe('who may see where the crew are', () => {
  it.each([[Role.OWNER], [Role.ADMIN]])('lets a %s see the map', (role) => {
    expect(maySeeCrewPositions(role)).toBe(true);
  });

  it('does not let one crew member watch another', () => {
    /*
     * The same line as pay and as the clock-in pins. Knowing where a colleague
     * is at two o'clock is not a colleague's business, and a product that made
     * it mutual would be handing every employee a tracker pointed at everybody
     * else.
     */
    expect(maySeeCrewPositions(Role.STAFF)).toBe(false);
  });
});
