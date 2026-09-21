import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TenantClient } from '@/lib/db/tenant';

/**
 * Measuring the drive once, and knowing when the answer has gone stale.
 *
 * Every quote used to take the travel distance from whatever somebody typed.
 * Measuring it instead is an obvious improvement with one non-obvious cost:
 * Google charges per request, and a naive version asks again on every reprice,
 * every draft, every time an owner opens a quote to change a word. So the
 * measurement is cached on the property, and these tests are mostly about the
 * cache being right rather than the arithmetic being right.
 *
 * The stale case is the one with teeth. Move the business across town and every
 * cached drive is wrong in the same direction, quietly, on every quote — so the
 * origin is stored with the measurement and compared, rather than trusted
 * because it is recent.
 */

const driveEstimate = vi.hoisted(() => vi.fn());
const mapsEnabled = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/lib/maps/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/maps/client')>('@/lib/maps/client');
  return { ...actual, driveEstimate, mapsEnabled };
});

const { driveFromBase } = await import('@/lib/maps/drive');

const SHOP = {
  addressLine1: '1 Depot Road',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
};

type CachedDrive = {
  driveMilesFromBase: number | null;
  driveMinutesFromBase: number | null;
  driveMeasuredFrom: string | null;
};

function stubClient(cached: CachedDrive | null) {
  const written: Record<string, unknown>[] = [];

  const db = {
    property: {
      findUnique: vi.fn().mockResolvedValue(cached),
      updateMany: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        written.push(data);
        return Promise.resolve({ count: 1 });
      }),
    },
  } as unknown as TenantClient;

  return { db, written };
}

beforeEach(() => {
  driveEstimate.mockReset();
  mapsEnabled.mockReset();
  mapsEnabled.mockReturnValue(true);
});

describe('measuring the drive from the shop', () => {
  it('asks once and keeps the answer on the property', async () => {
    driveEstimate.mockResolvedValue({ miles: 12, minutes: 19 });
    const { db, written } = stubClient(null);

    const result = await driveFromBase(db, SHOP, { propertyId: 'prop-1', address: '9 Elm St' });

    expect(result).toEqual({ miles: 12, minutes: 19 });
    expect(driveEstimate).toHaveBeenCalledTimes(1);
    expect(written[0]).toMatchObject({
      driveMilesFromBase: 12,
      driveMinutesFromBase: 19,
      // The origin is stored so the next read can tell whether it still applies.
      driveMeasuredFrom: '1 Depot Road, Austin, TX, 78701',
    });
  });

  it('uses the cached answer rather than asking again', async () => {
    const { db } = stubClient({
      driveMilesFromBase: 12,
      driveMinutesFromBase: 19,
      driveMeasuredFrom: '1 Depot Road, Austin, TX, 78701',
    });

    const result = await driveFromBase(db, SHOP, { propertyId: 'prop-1', address: '9 Elm St' });

    expect(result).toEqual({ miles: 12, minutes: 19 });
    // The whole point: a second quote for the same property costs nothing.
    expect(driveEstimate).not.toHaveBeenCalled();
  });

  it('measures again when the business has moved', async () => {
    /*
     * The failure this guards against is silent. Without the origin check, a
     * business that relocates keeps quoting travel from an address it left, and
     * every quote is wrong by the same amount in the same direction — which is
     * exactly the kind of error nobody notices for months.
     */
    driveEstimate.mockResolvedValue({ miles: 3, minutes: 7 });
    const { db, written } = stubClient({
      driveMilesFromBase: 12,
      driveMinutesFromBase: 19,
      driveMeasuredFrom: '40 Old Yard, Austin, TX, 78702',
    });

    const result = await driveFromBase(db, SHOP, { propertyId: 'prop-1', address: '9 Elm St' });

    expect(result).toEqual({ miles: 3, minutes: 7 });
    expect(driveEstimate).toHaveBeenCalledTimes(1);
    expect(written[0]).toMatchObject({ driveMeasuredFrom: '1 Depot Road, Austin, TX, 78701' });
  });

  it('measures without caching when there is no property to cache against', async () => {
    // A quote for a customer who has an address but no property row yet.
    driveEstimate.mockResolvedValue({ miles: 8, minutes: 14 });
    const { db, written } = stubClient(null);

    const result = await driveFromBase(db, SHOP, { address: '9 Elm St' });

    expect(result).toEqual({ miles: 8, minutes: 14 });
    expect(written).toHaveLength(0);
  });
});

describe('when the drive cannot be measured', () => {
  it('returns nothing when this deployment has no Maps key', async () => {
    mapsEnabled.mockReturnValue(false);
    const { db } = stubClient(null);

    expect(await driveFromBase(db, SHOP, { propertyId: 'p', address: '9 Elm St' })).toBeNull();
    expect(driveEstimate).not.toHaveBeenCalled();
  });

  it.each([
    ['the business has not filled in its own address', null, '9 Elm St'],
    ['the destination has no address', SHOP, '   '],
  ])('returns nothing when %s, without asking Google', async (_label, origin, address) => {
    const { db } = stubClient(null);

    expect(await driveFromBase(db, origin, { propertyId: 'p', address })).toBeNull();
    expect(driveEstimate).not.toHaveBeenCalled();
  });

  it('returns nothing when Google has no answer, and writes no cache', async () => {
    // Quoting must not stop because a third party was unhelpful: the travel line
    // falls back to the workspace default, exactly as it did before.
    driveEstimate.mockResolvedValue(null);
    const { db, written } = stubClient(null);

    expect(await driveFromBase(db, SHOP, { propertyId: 'p', address: '9 Elm St' })).toBeNull();
    expect(written).toHaveLength(0);
  });
});
