import { AutomationTrigger, JobStatus, LeadStatus, Prisma, QuoteStatus } from '@prisma/client';

import { conflict, notFound } from '@/lib/api/errors';
import { cancelRuns, fireTrigger } from '@/lib/automations/trigger';
import type { TenantClient } from '@/lib/db/tenant';
import { logActivity } from '@/lib/leads/repository';
import { generatePublicId, nextNumber, withNumberRetry } from '@/lib/quotes/numbering';
import type { PricingBreakdown } from '@/lib/pricing/engine';

/**
 * Quote reads and writes.
 *
 * The governing idea is that **a sent quote is a commercial document, not a
 * view of current settings**. Once it goes out it must show the same numbers
 * next year that it showed the day it was sent, even if labour rates have
 * doubled since. So the whole calculation is frozen onto the row — inputs and
 * outputs both — and line items copy the service's name and price rather than
 * joining to it.
 */

export const QUOTE_ROW_SELECT = {
  id: true,
  number: true,
  publicId: true,
  status: true,
  title: true,
  totalCents: true,
  subtotalCents: true,
  currency: true,
  sentAt: true,
  expiresAt: true,
  firstViewedAt: true,
  viewCount: true,
  respondedAt: true,
  createdAt: true,
  customerId: true,
  leadId: true,
} satisfies Prisma.QuoteSelect;

export type QuoteRow = Prisma.QuoteGetPayload<{ select: typeof QUOTE_ROW_SELECT }>;

/**
 * Whether a quote should be treated as expired right now.
 *
 * Derived rather than stored. Nothing sweeps the table flipping rows to EXPIRED,
 * so a quote whose `expiresAt` has passed still *says* SENT — and if the accept
 * path trusted the stored status, a customer could accept a three-month-old
 * price. Every read and every write asks this question instead.
 */
export function isExpired(
  quote: { status: QuoteStatus; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (quote.status === QuoteStatus.ACCEPTED || quote.status === QuoteStatus.DECLINED) {
    // A decision already made does not expire.
    return false;
  }
  return quote.expiresAt !== null && quote.expiresAt.getTime() <= now.getTime();
}

/** The status to show, with expiry applied. */
export function effectiveStatus(
  quote: { status: QuoteStatus; expiresAt: Date | null },
  now: Date = new Date(),
): QuoteStatus {
  return isExpired(quote, now) ? QuoteStatus.EXPIRED : quote.status;
}

/** Statuses a customer can still act on. */
export function isOpenForResponse(
  quote: { status: QuoteStatus; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (isExpired(quote, now)) return false;
  return (
    quote.status === QuoteStatus.SENT ||
    quote.status === QuoteStatus.VIEWED ||
    quote.status === QuoteStatus.CHANGES_REQUESTED
  );
}

export type CreateQuoteArgs = {
  organizationId: string;
  customerId?: string | null;
  leadId?: string | null;
  propertyId?: string | null;
  title?: string | null;
  summary?: string | null;
  terms?: string | null;
  validForDays: number;
  currency: string;
  breakdown: PricingBreakdown;
  /** The inputs that produced the breakdown, frozen for the audit trail. */
  pricingInput: Record<string, unknown>;
  items?: {
    serviceId?: string | null;
    name: string;
    description?: string | null;
    quantityMilli: number;
    unitPriceCents: number;
    taxable: boolean;
    optional: boolean;
  }[];
  serviceName?: string | null;
  actorUserId: string | null;
};

/**
 * Creates a DRAFT quote from a calculated breakdown.
 *
 * `expiresAt` is deliberately not set here. The clock starts when the customer
 * receives it, not when the owner drafts it — a quote written on Friday and sent
 * on Monday should be open for its full window.
 */
export async function createQuote(db: TenantClient, args: CreateQuoteArgs) {
  const { breakdown } = args;

  // One line per quote by default, named after the service. An owner can add
  // more; what matters is that the document always has something to show, since
  // a quote with a total and no lines reads like a demand rather than an offer.
  const items =
    args.items && args.items.length > 0
      ? args.items
      : [
          {
            serviceId: null,
            name: args.serviceName ?? args.title ?? 'Service',
            description: args.summary ?? null,
            quantityMilli: 1000,
            unitPriceCents: breakdown.subtotalCents,
            taxable: breakdown.taxRateBps > 0,
            optional: false,
          },
        ];

  return withNumberRetry(
    async (number) =>
      db.quote.create({
        data: {
          organizationId: args.organizationId,
          number,
          publicId: generatePublicId(),
          customerId: args.customerId ?? null,
          leadId: args.leadId ?? null,
          propertyId: args.propertyId ?? null,
          status: QuoteStatus.DRAFT,
          title: args.title ?? null,
          summary: args.summary ?? null,
          terms: args.terms ?? null,
          currency: args.currency,

          // Frozen inputs, so the document can be re-derived and defended.
          laborMinutes: Number(args.pricingInput.laborMinutes ?? 0),
          laborRateCents: Number(args.pricingInput.laborRateCents ?? 0),
          travelMiles: Number(args.pricingInput.travelMiles ?? 0),

          // Frozen outputs.
          laborCostCents: breakdown.laborCostCents,
          materialCostCents: breakdown.materialCostCents,
          equipmentCostCents: breakdown.equipmentCostCents,
          travelCostCents: breakdown.travelCostCents,
          overheadCents: breakdown.overheadCents,
          estimatedCostCents: breakdown.estimatedCostCents,
          profitMarginBps: breakdown.targetMarginBps,
          subtotalCents: breakdown.subtotalCents,
          discountCents: breakdown.discountCents,
          taxRateBps: breakdown.taxRateBps,
          taxCents: breakdown.taxCents,
          totalCents: breakdown.totalCents,
          priceOverridden: breakdown.overridden,

          items: {
            create: items.map((item, index) => ({
              organizationId: args.organizationId,
              serviceId: item.serviceId ?? null,
              name: item.name,
              description: item.description ?? null,
              quantityMilli: item.quantityMilli,
              unitPriceCents: item.unitPriceCents,
              // Rounded here rather than stored as a float: the line total is
              // what a customer adds up by hand, and it has to match.
              totalCents: Math.round((item.quantityMilli / 1000) * item.unitPriceCents),
              taxable: item.taxable,
              optional: item.optional,
              position: index,
            })),
          },
        },
        select: QUOTE_ROW_SELECT,
      }),
    () => nextNumber(db, 'quote'),
  );
}

/** Everything the internal quote page and the public page need. */
export async function getQuoteByIdOrPublicId(
  db: TenantClient,
  where: { id: string } | { publicId: string },
) {
  const quote = await db.quote.findFirst({
    where,
    include: {
      items: { orderBy: { position: 'asc' } },
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
        },
      },
      property: {
        select: { id: true, addressLine1: true, city: true, state: true, postalCode: true },
      },
      lead: { select: { id: true, status: true } },
      jobs: { select: { id: true, number: true, status: true } },
    },
  });

  if (!quote) throw notFound('That quote does not exist.');
  return quote;
}

/**
 * Marks a quote as sent and starts its clock.
 *
 * Only a draft can be sent. Re-sending an already-sent quote would restart the
 * expiry window and reset the follow-up sequence, quietly giving a customer who
 * has been ignoring it another thirty days.
 */
export async function sendQuote(
  db: TenantClient,
  organizationId: string,
  id: string,
  validForDays: number,
  actorUserId: string | null,
) {
  const quote = await db.quote.findUnique({
    where: { id },
    select: { id: true, status: true, leadId: true, number: true },
  });
  if (!quote) throw notFound('That quote does not exist.');

  if (quote.status !== QuoteStatus.DRAFT) {
    throw conflict('That quote has already been sent.');
  }

  const now = new Date();

  const updated = await db.quote.update({
    where: { id },
    data: {
      status: QuoteStatus.SENT,
      sentAt: now,
      expiresAt: new Date(now.getTime() + validForDays * 86_400_000),
    },
    select: QUOTE_ROW_SELECT,
  });

  if (quote.leadId) {
    await db.lead.update({
      where: { id: quote.leadId },
      data: { status: LeadStatus.QUOTE_SENT, lastContactedAt: now },
    });

    await logActivity(db, organizationId, {
      leadId: quote.leadId,
      type: 'quote_sent',
      summary: `Quote ${quote.number} sent`,
      detail: { quoteId: id },
      actorUserId,
    });
  }

  // The follow-up sequence starts here rather than at creation: the clock the
  // customer experiences begins when they receive it.
  await fireTrigger(db, organizationId, AutomationTrigger.QUOTE_SENT, {
    type: 'quote',
    id,
  });

  return updated;
}

/**
 * Records that the customer opened the quote.
 *
 * Called from the page rather than during its render, so a prefetch or a
 * double-render in development does not invent a view. The first view is the
 * interesting one — it is what tells an owner the quote actually arrived — so
 * `firstViewedAt` is written once and never overwritten.
 */
export async function recordQuoteView(db: TenantClient, publicId: string): Promise<void> {
  const quote = await db.quote.findFirst({
    where: { publicId },
    select: { id: true, status: true, firstViewedAt: true },
  });

  if (!quote) return;

  await db.quote.update({
    where: { id: quote.id },
    data: {
      viewCount: { increment: 1 },
      ...(quote.firstViewedAt === null ? { firstViewedAt: new Date() } : {}),
      // SENT → VIEWED, and nothing else. A quote the customer has already
      // responded to must not be dragged backwards by them re-opening the page.
      ...(quote.status === QuoteStatus.SENT ? { status: QuoteStatus.VIEWED } : {}),
    },
  });
}

export type RespondResult = {
  status: QuoteStatus;
  jobId: string | null;
  jobNumber: string | null;
};

/**
 * The customer's decision.
 *
 * Accepting is the moment the product earns its keep, and it has to do four
 * things at once: settle the quote, create the job, tell the owner, and move the
 * lead. All of it in one transaction — a quote marked accepted with no job
 * behind it is a job nobody does.
 *
 * It is also idempotent. A customer double-tapping Accept on a phone, or a link
 * preview fetching the endpoint, must not produce two jobs for one quote.
 */
export async function respondToQuote(
  db: TenantClient,
  organizationId: string,
  publicId: string,
  action: 'accept' | 'decline' | 'changes',
  note: string | null,
): Promise<RespondResult> {
  const quote = await db.quote.findFirst({
    where: { publicId },
    select: {
      id: true,
      number: true,
      status: true,
      expiresAt: true,
      title: true,
      summary: true,
      totalCents: true,
      currency: true,
      customerId: true,
      propertyId: true,
      leadId: true,
      items: { select: { serviceId: true, name: true }, orderBy: { position: 'asc' }, take: 1 },
    },
  });

  if (!quote) throw notFound('That quote does not exist.');

  // Already decided. Returning the existing outcome rather than an error is what
  // makes a double-tap harmless: the second request sees the same result as the
  // first instead of a scary message.
  if (quote.status === QuoteStatus.ACCEPTED) {
    const existing = await db.job.findFirst({
      where: { quoteId: quote.id },
      select: { id: true, number: true },
    });
    return {
      status: QuoteStatus.ACCEPTED,
      jobId: existing?.id ?? null,
      jobNumber: existing?.number ?? null,
    };
  }

  if (quote.status === QuoteStatus.DECLINED) {
    return { status: QuoteStatus.DECLINED, jobId: null, jobNumber: null };
  }

  if (quote.status === QuoteStatus.DRAFT) {
    // A draft has no business being reachable, but its publicId exists from
    // creation, so the guard has to be here too.
    throw notFound('That quote does not exist.');
  }

  if (isExpired(quote)) {
    throw conflict(
      'This quote has expired. Please contact us and we will send you an up-to-date price.',
    );
  }

  const now = new Date();

  // The customer has answered, so stop chasing them. Before anything else, so a
  // failure further down cannot leave a sequence running against someone who
  // already replied.
  await cancelRuns(db, { type: 'quote', id: quote.id }, { reason: `customer ${action}` });

  if (action === 'changes') {
    await db.quote.update({
      where: { id: quote.id },
      data: {
        status: QuoteStatus.CHANGES_REQUESTED,
        customerNote: note,
        respondedAt: now,
      },
    });

    await notifyOwner(db, organizationId, {
      type: 'quote.changes_requested',
      title: `Changes requested on ${quote.number}`,
      body: note ?? 'The customer asked for changes.',
      href: `/quotes/${quote.id}`,
    });

    if (quote.leadId) {
      await db.lead.update({
        where: { id: quote.leadId },
        data: { status: LeadStatus.NEGOTIATING },
      });
      await logActivity(db, organizationId, {
        leadId: quote.leadId,
        type: 'quote_changes_requested',
        summary: note ? `Customer asked for changes: ${note}` : 'Customer asked for changes',
        detail: { quoteId: quote.id },
        actorUserId: null,
      });
    }

    return { status: QuoteStatus.CHANGES_REQUESTED, jobId: null, jobNumber: null };
  }

  if (action === 'decline') {
    await db.quote.update({
      where: { id: quote.id },
      data: { status: QuoteStatus.DECLINED, customerNote: note, respondedAt: now },
    });

    await notifyOwner(db, organizationId, {
      type: 'quote.declined',
      title: `${quote.number} was declined`,
      body: note ?? undefined,
      href: `/quotes/${quote.id}`,
    });

    if (quote.leadId) {
      await db.lead.update({
        where: { id: quote.leadId },
        data: {
          status: LeadStatus.LOST,
          closedAt: now,
          lostReason: note ?? 'Quote declined',
        },
      });
      await logActivity(db, organizationId, {
        leadId: quote.leadId,
        type: 'quote_declined',
        summary: note ? `Quote declined: ${note}` : 'Quote declined',
        detail: { quoteId: quote.id },
        actorUserId: null,
      });
    }

    return { status: QuoteStatus.DECLINED, jobId: null, jobNumber: null };
  }

  // ── Accept ──────────────────────────────────────────────────────────────

  // A job needs a customer. A quote can be drafted against a bare lead, so one
  // is created from the lead at the moment of acceptance rather than blocking
  // the customer at the only step that matters.
  let customerId = quote.customerId;

  if (!customerId) {
    if (!quote.leadId) {
      throw conflict('This quote is not attached to a customer. Please contact us.');
    }

    const lead = await db.lead.findUnique({
      where: { id: quote.leadId },
      select: {
        customerId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        addressLine1: true,
        city: true,
        state: true,
        postalCode: true,
      },
    });

    if (!lead) throw conflict('This quote is not attached to a customer. Please contact us.');

    if (lead.customerId) {
      customerId = lead.customerId;
    } else {
      const created = await db.customer.create({
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
      customerId = created.id;
    }
  }

  const job = await withNumberRetry(
    async (number) =>
      db.job.create({
        data: {
          organizationId,
          number,
          customerId: customerId!,
          propertyId: quote.propertyId,
          quoteId: quote.id,
          serviceId: quote.items[0]?.serviceId ?? null,
          status: JobStatus.SCHEDULED,
          title: quote.title ?? quote.items[0]?.name ?? `Job from ${quote.number}`,
          description: quote.summary,
          // Copied, not joined: the agreed price is now the job's own and must
          // not move if the quote is ever edited.
          priceCents: quote.totalCents,
          currency: quote.currency,
        },
        select: { id: true, number: true },
      }),
    () => nextNumber(db, 'job'),
  );

  await db.quote.update({
    where: { id: quote.id },
    data: { status: QuoteStatus.ACCEPTED, respondedAt: now, customerNote: note },
  });

  await notifyOwner(db, organizationId, {
    type: 'quote.accepted',
    title: `${quote.number} accepted — job ${job.number} created`,
    body: 'Schedule it and you are away.',
    href: `/jobs/${job.id}`,
  });

  await fireTrigger(db, organizationId, AutomationTrigger.JOB_SCHEDULED, {
    type: 'job',
    id: job.id,
  });

  if (quote.leadId) {
    await db.lead.update({
      where: { id: quote.leadId },
      data: { status: LeadStatus.WON, closedAt: now, customerId },
    });
    await logActivity(db, organizationId, {
      leadId: quote.leadId,
      type: 'quote_accepted',
      summary: `Quote ${quote.number} accepted — job ${job.number} created`,
      detail: { quoteId: quote.id, jobId: job.id },
      actorUserId: null,
    });
  }

  return { status: QuoteStatus.ACCEPTED, jobId: job.id, jobNumber: job.number };
}

/**
 * Tells the business something happened.
 *
 * `userId: null` means everyone in the workspace, which is right here: a quote
 * being accepted is not one person's news.
 */
async function notifyOwner(
  db: TenantClient,
  organizationId: string,
  notification: { type: string; title: string; body?: string; href?: string },
): Promise<void> {
  await db.notification.create({
    data: {
      organizationId,
      userId: null,
      type: notification.type,
      title: notification.title,
      body: notification.body ?? null,
      href: notification.href ?? null,
    },
  });
}
