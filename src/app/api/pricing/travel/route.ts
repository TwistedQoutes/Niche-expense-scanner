import { z } from 'zod';

import { conflict, notImplemented, validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireAuth } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { driveEstimate, formatAddress, mapsEnabled } from '@/lib/maps/client';
import { idSchema, singleLineText } from '@/lib/validation/common';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    /** A saved property, whose stored address is used. */
    propertyId: idSchema.optional(),
    /** Or a typed address, for a lead that is not a customer yet. */
    address: singleLineText(300).optional(),
  })
  .refine((value) => Boolean(value.propertyId ?? value.address), {
    message: 'Give a property or an address.',
    path: ['address'],
  });

/**
 * How far the truck has to drive, so the per-mile rule has a number to work with.
 *
 * Costs a billed Google request, so it is rate-limited and only ever runs when
 * someone presses the button — never on page load, and never as a side effect of
 * opening the calculator.
 *
 * The answer is returned rather than saved. Mileage belongs to the quote it was
 * calculated for: roads change, the business moves, and a figure frozen onto a
 * property would silently go stale while looking authoritative. The quote freezes
 * it at the moment it is priced, which is the record that matters.
 */
export const POST = withRoute(async (request) => {
  const auth = await requireAuth();
  enforceRateLimit(RATE_LIMITS.ai, auth.organization.id);

  if (!mapsEnabled()) {
    throw notImplemented(
      'Address lookup is not configured on this deployment, so drive distance cannot be calculated. Enter the miles by hand.',
    );
  }

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const organization = await prisma.organization.findUnique({
    where: { id: auth.organization.id },
    select: { addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true },
  });

  const origin = formatAddress(organization ?? {});
  if (!origin) {
    // Nothing to measure from. Said plainly, with the fix, rather than returning
    // a zero that would quietly price every job as if it were next door.
    throw conflict('Add your business address in Settings first — the drive is measured from it.');
  }

  let destination = parsed.data.address?.trim() ?? '';

  if (parsed.data.propertyId) {
    // Through the tenant client: a property id from another business is absent,
    // not forbidden.
    const property = await auth.db.property.findUnique({
      where: { id: parsed.data.propertyId },
      select: {
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
      },
    });

    if (!property) throw validationFailed({ propertyId: 'That property does not exist.' });
    destination = formatAddress(property);
  }

  if (!destination) throw validationFailed({ address: 'Give an address to measure to.' });

  const estimate = await driveEstimate(origin, destination);

  if (!estimate) {
    throw conflict(
      'That address could not be found, so the drive could not be measured. Enter the miles by hand.',
    );
  }

  return jsonOk({ travel: estimate, from: origin, to: destination });
});
