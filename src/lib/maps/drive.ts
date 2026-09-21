import { driveEstimate, formatAddress, mapsEnabled } from '@/lib/maps/client';
import type { TenantClient } from '@/lib/db/tenant';

/**
 * How far the truck has to go, measured once and remembered.
 *
 * The mileage on a quote used to be a number somebody typed, or a button
 * somebody remembered to press. Both are wrong in the same direction: the
 * awkward customer forty minutes away gets quoted as though they were round the
 * corner, because nobody wants to stop mid-quote and go and measure a drive.
 *
 * So it is measured when a quote is priced, from the business's own address to
 * the property, and then kept. Three things make that safe to do automatically:
 *
 *  - **It is cached on the property.** Road distance does not change between
 *    quotes, and Google bills per request. A property is measured once, not once
 *    per quote.
 *  - **The origin is stored with it.** Move the shop across town and every
 *    cached drive is wrong; comparing the stored origin against the current one
 *    is how that gets noticed instead of being carried into every future quote.
 *  - **It never fails a quote.** No key, no address, no answer from Google — all
 *    of them return null, the travel line falls back to whatever the service or
 *    the workspace default says, and the owner is not stopped from quoting
 *    because a third party was slow.
 */

export type MeasuredDrive = { miles: number; minutes: number };

/** The property being quoted, or just an address when there is no property row. */
export type DriveDestination = {
  /** When present, the measurement is cached against this property. */
  propertyId?: string | null;
  /** One-line address, as a geocoder wants it. */
  address: string;
};

export type DriveOrigin = {
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country?: string | null;
};

/**
 * A cached drive is only good for the origin it was measured from.
 *
 * Compared as text rather than by date: an address that has not changed gives
 * the same string, and one that has changed gives a different one, which is
 * exactly the question being asked. A time-based expiry would answer a different
 * one — "is this old?" — and roads do not move on a schedule.
 */
function sameOrigin(stored: string | null, current: string): boolean {
  return Boolean(stored) && stored === current;
}

export async function driveFromBase(
  db: TenantClient,
  origin: DriveOrigin | null,
  destination: DriveDestination,
): Promise<MeasuredDrive | null> {
  if (!mapsEnabled()) return null;

  const from = origin ? formatAddress(origin) : '';
  const to = destination.address.trim();

  // Both ends are needed. A business that has not filled in its own address
  // cannot have a drive measured from it, which is a thing to say in Settings
  // rather than a request to send to Google.
  if (!from || !to) return null;

  if (destination.propertyId) {
    const cached = await db.property.findUnique({
      where: { id: destination.propertyId },
      select: {
        driveMilesFromBase: true,
        driveMinutesFromBase: true,
        driveMeasuredFrom: true,
      },
    });

    if (
      cached?.driveMilesFromBase !== null &&
      cached?.driveMilesFromBase !== undefined &&
      cached.driveMinutesFromBase !== null &&
      sameOrigin(cached.driveMeasuredFrom, from)
    ) {
      return { miles: cached.driveMilesFromBase, minutes: cached.driveMinutesFromBase };
    }
  }

  const measured = await driveEstimate(from, to);
  if (!measured) return null;

  if (destination.propertyId) {
    /*
     * Written through the tenant client, so a property id from another business
     * cannot be updated even if one were somehow passed in. `updateMany` rather
     * than `update` because a property that has been deleted between the read
     * and the write is not worth throwing over — the measurement is still
     * returned and used for this quote.
     */
    await db.property.updateMany({
      where: { id: destination.propertyId },
      data: {
        driveMilesFromBase: measured.miles,
        driveMinutesFromBase: measured.minutes,
        driveMeasuredFrom: from,
        driveMeasuredAt: new Date(),
      },
    });
  }

  return measured;
}

/**
 * Where the quote is going, from whichever record knows.
 *
 * A quote can be attached to a property, a customer, or a lead who is not a
 * customer yet, and each of those can carry an address. They are tried in that
 * order because that is the order of specificity: the property is the place the
 * work happens, the customer's address is usually the same place, and a lead's
 * address is what somebody typed on the phone.
 *
 * Returns null when none of them has an address, which is ordinary — plenty of
 * quotes are written before anybody has asked where the house is.
 */
export async function destinationFor(
  db: TenantClient,
  ids: { propertyId?: string | null; customerId?: string | null; leadId?: string | null },
): Promise<DriveDestination | null> {
  if (ids.propertyId) {
    const property = await db.property.findUnique({
      where: { id: ids.propertyId },
      select: { addressLine1: true, city: true, state: true, postalCode: true, country: true },
    });

    const address = property ? formatAddress(property) : '';
    if (address) return { propertyId: ids.propertyId, address };
  }

  if (ids.customerId) {
    const customer = await db.customer.findUnique({
      where: { id: ids.customerId },
      select: { addressLine1: true, city: true, state: true, postalCode: true, country: true },
    });

    const address = customer ? formatAddress(customer) : '';
    // No propertyId: nothing to cache it against, so this one is measured each
    // time. Converting the lead creates the property, and the caching with it.
    if (address) return { address };
  }

  if (ids.leadId) {
    const lead = await db.lead.findUnique({
      where: { id: ids.leadId },
      select: {
        propertyId: true,
        addressLine1: true,
        city: true,
        state: true,
        postalCode: true,
      },
    });

    if (lead) {
      // A lead that already points at a property gets the cached measurement.
      if (lead.propertyId) return destinationFor(db, { propertyId: lead.propertyId });

      const address = formatAddress(lead);
      if (address) return { address };
    }
  }

  return null;
}
