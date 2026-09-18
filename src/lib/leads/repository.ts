import { LeadStatus, Prisma } from '@prisma/client';

import { conflict, notFound } from '@/lib/api/errors';
import { assertOwned } from '@/lib/db/ownership';
import { formatAddress, geocodeAddress } from '@/lib/maps/client';
import type { TenantClient } from '@/lib/db/tenant';
import { POSITION_GAP, positionBetween, respacedPositions } from '@/lib/leads/pipeline';

/**
 * Lead reads and writes.
 *
 * Every function takes the tenant-scoped client from `requireAuth()`, so none
 * of them mentions `organizationId` — it is applied underneath (see
 * src/lib/db/tenant.ts). The one exception is `create`, where Prisma's
 * generated types require the field even though the extension would supply it;
 * passing it explicitly costs a line and changes nothing about the guarantee.
 */

/** The fields the board and list need. Kept narrow: these queries are hot. */
export const LEAD_CARD_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  city: true,
  status: true,
  position: true,
  source: true,
  serviceRequested: true,
  estimatedValueCents: true,
  aiScore: true,
  aiUrgency: true,
  nextFollowUpAt: true,
  lastContactedAt: true,
  createdAt: true,
  customerId: true,
} satisfies Prisma.LeadSelect;

export type LeadCard = Prisma.LeadGetPayload<{ select: typeof LEAD_CARD_SELECT }>;

/**
 * Records what happened to a lead.
 *
 * Appended for every state change, by humans and automations alike, so the
 * timeline on a lead page tells the whole story — including who moved a card
 * and when a follow-up went out. Written inside the same transaction as the
 * change it describes, so the two cannot disagree.
 */
export async function logActivity(
  db: TenantClient,
  organizationId: string,
  input: {
    leadId: string;
    type: string;
    summary: string;
    detail?: Prisma.InputJsonValue;
    actorUserId?: string | null;
  },
): Promise<void> {
  await db.leadActivity.create({
    data: {
      organizationId,
      leadId: input.leadId,
      type: input.type,
      summary: input.summary,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      actorUserId: input.actorUserId ?? null,
    },
  });
}

/**
 * Respaces a column so there is room between every pair again.
 *
 * Shared by the insert and move paths. Ordering is preserved: the rows are read
 * in their current order and written back evenly spaced.
 */
async function respaceColumn(db: TenantClient, status: LeadStatus): Promise<string[]> {
  const column = await db.lead.findMany({
    where: { status },
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    select: { id: true },
  });

  const spaced = respacedPositions(column.length);
  await db.$transaction(
    column.map((row, index) =>
      db.lead.update({ where: { id: row.id }, data: { position: spaced[index]! } }),
    ),
  );

  return column.map((row) => row.id);
}

/**
 * Where a new lead sits in its column.
 *
 * New leads go to the *top* of NEW, not the bottom. The whole product argument
 * is that response time decides who wins the job, so the newest enquiry has to
 * be the first thing an owner sees, not something they scroll to.
 *
 * Halving the current top position is what makes room above it. When that runs
 * out — a column whose first card sits at 0 or 1 — the column is respaced
 * first. Returning a constant instead, as this did originally, silently gave
 * every subsequent lead the *same* position: the column then had no defined
 * order at all, and only the secondary sort was keeping the board sensible.
 */
async function topPosition(db: TenantClient, status: LeadStatus): Promise<number> {
  const first = await db.lead.findFirst({
    where: { status },
    orderBy: { position: 'asc' },
    select: { position: true },
  });

  if (!first) return POSITION_GAP;
  if (first.position > 1) return Math.floor(first.position / 2);

  await respaceColumn(db, status);
  // After respacing the first card sits at POSITION_GAP, so there is room again.
  return Math.floor(POSITION_GAP / 2);
}

export async function listLeads(
  db: TenantClient,
  options: {
    status?: LeadStatus;
    search?: string;
    minScore?: number;
    cursor?: string;
    limit: number;
  },
) {
  const where: Prisma.LeadWhereInput = {};

  if (options.status) where.status = options.status;
  if (options.minScore !== undefined) where.aiScore = { gte: options.minScore };

  if (options.search) {
    // Case-insensitive across the fields someone would actually type: a name,
    // a phone number, an email, or the service they asked for.
    where.OR = [
      { firstName: { contains: options.search, mode: 'insensitive' } },
      { lastName: { contains: options.search, mode: 'insensitive' } },
      { email: { contains: options.search, mode: 'insensitive' } },
      { phone: { contains: options.search } },
      { serviceRequested: { contains: options.search, mode: 'insensitive' } },
      { addressLine1: { contains: options.search, mode: 'insensitive' } },
    ];
  }

  // One extra row, to find out whether there is a next page without a count().
  const rows = await db.lead.findMany({
    where,
    select: LEAD_CARD_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > options.limit;
  const leads = hasMore ? rows.slice(0, options.limit) : rows;

  return { leads, nextCursor: hasMore ? (leads.at(-1)?.id ?? null) : null };
}

/**
 * A board card, with the time-relative flags already resolved.
 *
 * "Is this follow-up overdue?" is answered here rather than in the component,
 * for two reasons: React's purity rule (correctly) forbids reading the clock
 * during render, and "as of when" is a property of the data load, not of a
 * re-render that happens to occur later.
 */
export type BoardCard = LeadCard & { followUpOverdue: boolean };

/** Every open column, ordered for the board. */
export async function loadBoard(db: TenantClient, now: Date = new Date()) {
  const leads = await db.lead.findMany({
    select: LEAD_CARD_SELECT,
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    // A board is for working, not archiving. Past a few hundred cards it stops
    // being usable anyway, and the list view with filters is the right tool.
    take: 500,
  });

  const byStatus = new Map<LeadStatus, BoardCard[]>();
  for (const lead of leads) {
    const column = byStatus.get(lead.status) ?? [];
    column.push({
      ...lead,
      followUpOverdue:
        lead.nextFollowUpAt !== null && lead.nextFollowUpAt.getTime() < now.getTime(),
    });
    byStatus.set(lead.status, column);
  }

  return byStatus;
}

export async function getLead(db: TenantClient, id: string) {
  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
      property: {
        select: { id: true, addressLine1: true, city: true, state: true, postalCode: true },
      },
      activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      quotes: {
        select: { id: true, number: true, status: true, totalCents: true, sentAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!lead) throw notFound('That lead does not exist.');
  return lead;
}

export type CreateLeadData = Omit<Prisma.LeadUncheckedCreateInput, 'organizationId' | 'position'>;

export async function createLead(
  db: TenantClient,
  organizationId: string,
  data: CreateLeadData,
  actorUserId: string | null,
) {
  // A caller may attach the lead to an existing customer or property. Both ids
  // come from the request body, and a foreign key is not covered by the tenant
  // client — see src/lib/db/ownership.ts for what that let through.
  await assertOwned(db, { customerId: data.customerId, propertyId: data.propertyId });

  const status = data.status ?? LeadStatus.NEW;
  const position = await topPosition(db, status);

  const lead = await db.lead.create({
    data: { ...data, organizationId, status, position },
    select: LEAD_CARD_SELECT,
  });

  await logActivity(db, organizationId, {
    leadId: lead.id,
    type: 'lead.created',
    summary: actorUserId ? 'Lead added' : 'Lead captured',
    detail: { source: lead.source },
    actorUserId,
  });

  return lead;
}

/**
 * Moves a card to a new column and slot.
 *
 * Two things make this fiddly and both are handled here rather than in the
 * client: computing a position from the cards it was dropped between, and
 * respacing the column when the integers between two neighbours run out.
 */
export async function moveLead(
  db: TenantClient,
  organizationId: string,
  id: string,
  input: { status: LeadStatus; afterId?: string | null; beforeId?: string | null },
  actorUserId: string | null,
) {
  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, status: true, position: true },
  });
  if (!lead) throw notFound('That lead does not exist.');

  const neighbours = await db.lead.findMany({
    where: {
      id: { in: [input.afterId, input.beforeId].filter((value): value is string => Boolean(value)) },
    },
    select: { id: true, position: true, status: true },
  });

  const above = neighbours.find((row) => row.id === input.afterId);
  const below = neighbours.find((row) => row.id === input.beforeId);

  // A neighbour in a different column means the client's view of the board is
  // stale — someone else moved a card. Rejecting is better than silently
  // placing it somewhere the user did not point at.
  if ((above && above.status !== input.status) || (below && below.status !== input.status)) {
    throw conflict('The board has changed. Refresh and try that move again.');
  }

  let position: number;
  const computed = positionBetween(above?.position ?? null, below?.position ?? null);

  if (computed.kind === 'position') {
    position = computed.position;
  } else {
    // The gap is exhausted. Respace the whole column, then place the card at
    // the slot the user actually chose.
    const order = await respaceColumn(db, input.status);
    const spaced = respacedPositions(order.length);

    const anchorIndex = order.findIndex((rowId) => rowId === (input.afterId ?? input.beforeId));
    const anchor = spaced[anchorIndex === -1 ? 0 : anchorIndex] ?? POSITION_GAP;
    position = input.afterId ? anchor + POSITION_GAP / 2 : Math.floor(anchor / 2);
  }

  const statusChanged = lead.status !== input.status;

  const updated = await db.lead.update({
    where: { id },
    data: {
      status: input.status,
      position,
      // Leaving the pipeline is a dated event; the analytics funnel measures
      // time-to-close from it, so it has to be stamped when it happens.
      ...(statusChanged && (input.status === LeadStatus.WON || input.status === LeadStatus.LOST)
        ? { closedAt: new Date() }
        : {}),
      // Re-opening a closed lead has to clear the stamp, or it keeps a close
      // date while sitting in an open column.
      ...(statusChanged && lead.status === LeadStatus.WON && input.status !== LeadStatus.WON
        ? { closedAt: null }
        : {}),
      ...(statusChanged && lead.status === LeadStatus.LOST && input.status !== LeadStatus.LOST
        ? { closedAt: null }
        : {}),
    },
    select: LEAD_CARD_SELECT,
  });

  if (statusChanged) {
    await logActivity(db, organizationId, {
      leadId: id,
      type: 'status_changed',
      summary: `Moved from ${lead.status} to ${input.status}`,
      detail: { from: lead.status, to: input.status },
      actorUserId,
    });
  }

  return updated;
}

/**
 * Turns a lead into a customer.
 *
 * The lead is kept rather than consumed: it is the record of how this customer
 * was won, which the analytics funnel and the source-attribution report both
 * need. It gains a `customerId` and moves to WON.
 */
export async function convertLead(
  db: TenantClient,
  organizationId: string,
  id: string,
  options: { customerId?: string | null; createProperty: boolean },
  actorUserId: string | null,
) {
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) throw notFound('That lead does not exist.');

  if (lead.customerId) {
    throw conflict('That lead has already been converted.');
  }

  let customerId = options.customerId ?? null;

  if (!customerId) {
    const customer = await db.customer.create({
      data: {
        organizationId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        addressLine1: lead.addressLine1,
        city: lead.city,
        state: lead.state,
        postalCode: lead.postalCode,
      },
      select: { id: true },
    });
    customerId = customer.id;
  } else {
    // Guard the caller-supplied id. The tenant client stops it pointing at
    // another business, but within this one it could still be a typo.
    const existing = await db.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!existing) throw notFound('That customer does not exist.');
  }

  let propertyId = lead.propertyId;

  if (options.createProperty && !propertyId && lead.addressLine1) {
    /*
     * Geocoded on the way in, if this deployment has a Maps key.
     *
     * Coordinates are what make the drive-distance calculation possible later,
     * and converting a lead is the one moment the address is known and somebody
     * is waiting anyway. A failure returns null and the property is saved
     * without them — an address a human can read is still an address, and
     * refusing to convert a won lead because a third party was slow would be the
     * tail wagging the dog.
     *
     * Note what is *not* set: `lawnAreaSqFt` and `measurementSource`. Nothing
     * automated writes those. See src/lib/maps/client.ts.
     */
    const geocoded = await geocodeAddress(
      formatAddress({
        addressLine1: lead.addressLine1,
        city: lead.city,
        state: lead.state,
        postalCode: lead.postalCode,
      }),
    );

    const property = await db.property.create({
      data: {
        organizationId,
        customerId,
        addressLine1: lead.addressLine1,
        city: lead.city,
        state: lead.state,
        postalCode: lead.postalCode,
        ...(geocoded
          ? {
              latitude: geocoded.latitude,
              longitude: geocoded.longitude,
              googlePlaceId: geocoded.placeId || null,
            }
          : {}),
      },
      select: { id: true },
    });
    propertyId = property.id;
  }

  const updated = await db.lead.update({
    where: { id },
    data: {
      customerId,
      propertyId,
      status: LeadStatus.WON,
      closedAt: lead.closedAt ?? new Date(),
    },
    select: LEAD_CARD_SELECT,
  });

  await logActivity(db, organizationId, {
    leadId: id,
    type: 'lead.converted',
    summary: 'Converted to a customer',
    detail: { customerId, propertyId },
    actorUserId,
  });

  return { lead: updated, customerId, propertyId };
}
