import {
  AutomationTrigger,
  Channel,
  LeadSource,
  MessageDirection,
  MessageStatus,
  UsageMetric,
} from '@prisma/client';

import { cancelRunsForCustomer, cancelRuns, fireTrigger, type AutomationSubject } from '@/lib/automations/trigger';
import { runDueAutomations } from '@/lib/automations/worker';
import { recordUsage } from '@/lib/billing/usage';
import { prisma } from '@/lib/db/client';
import { forOrganization, type TenantClient } from '@/lib/db/tenant';
import { createLead } from '@/lib/leads/repository';
import {
  OPTED_OUT_TAG,
  OPT_IN_CONFIRMATION,
  OPT_OUT_CONFIRMATION,
  isOptIn,
  isOptOut,
} from '@/lib/messaging/optout';
import { findOrCreateConversation } from '@/lib/messaging/send';
import { sendSms } from '@/lib/sms';

/**
 * Handling what arrives from a customer.
 *
 * Two events come in on the same webhook and mean very different things:
 *
 *  - **An inbound message.** File it in the thread, and — crucially — stop every
 *    follow-up sequence aimed at that person. A customer who replies and then
 *    gets "just checking in" two days later has been told, plainly, that nobody
 *    is reading.
 *  - **A missed call.** Turn it into a lead and text back within seconds. This is
 *    the feature the landing page leads with, because a homeowner rings three
 *    companies and hires whoever answers.
 */

/**
 * The last ten digits of a phone number, or null if there aren't ten.
 *
 * Numbers reach us in every shape a person or a carrier might write them —
 * `(512) 555-0101`, `+1 512 555 0101`, `5125550101` — and the last ten digits are
 * what those spellings agree on for a North American number.
 */
export function normaliseNumber(value: string): string | null {
  const digits = value.replace(/[^\d]/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Every organization whose own phone number is the one dialled.
 *
 * Pure and exported so the awkward case — more than one claimant — is testable
 * without a database. The caller decides what to do about it; see below.
 */
export function organizationsClaimingNumber(
  organizations: ReadonlyArray<{ id: string; phone: string | null }>,
  to: string,
): string[] {
  const normalised = normaliseNumber(to);
  if (!normalised) return [];

  return organizations
    .filter((organization) => normaliseNumber(organization.phone ?? '') === normalised)
    .map((organization) => organization.id);
}

/** Which business a number belongs to. Resolved from the Twilio number dialled. */
export async function organizationForTwilioNumber(to: string): Promise<string | null> {
  /*
   * A single shared Twilio number cannot identify a tenant, so resolution is by
   * the business's own stored phone number. Until per-organization numbers are
   * provisioned this is the honest mapping, and it fails closed: an unmatched
   * number is ignored rather than guessed at, because attributing a stranger's
   * text to an arbitrary business would put one customer's message in another
   * business's inbox.
   */
  if (!normaliseNumber(to)) return null;

  const organizations = await prisma.organization.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
  });

  const claimants = organizationsClaimingNumber(organizations, to);

  /*
   * Two businesses claiming the same number is not a tie to be broken.
   *
   * Picking the first match — the oldest row, as it happens — would file a
   * stranger's text in whichever workspace happened to sign up first, which is
   * one tenant reading another tenant's customer. Nothing here says whose
   * customer this is, so nothing is guessed: the message is dropped and the
   * collision logged for an operator to sort out. Per-organization provisioned
   * numbers are what makes this case impossible; until then it is refused rather
   * than resolved.
   */
  if (claimants.length > 1) {
    console.error(
      '[twilio] refusing an ambiguous inbound: more than one organization claims this number',
      { to, organizationIds: claimants },
    );

    return null;
  }

  return claimants[0] ?? null;
}

/** Finds the customer or lead this number already belongs to. */
async function identify(db: TenantClient, phone: string) {
  /*
   * No identification from a partial number.
   *
   * `slice(-10)` on a short code like "5555" yields "5555", and a `contains`
   * search for that would match any customer whose number happens to include
   * those digits — attributing a carrier message to an unrelated person. An
   * unidentified sender is filed under the number alone, which is correct.
   */
  const last10 = normaliseNumber(phone);

  if (!last10) return { customer: null, lead: null };

  const [customer, lead] = await Promise.all([
    db.customer.findFirst({
      where: { phone: { contains: last10 } },
      select: { id: true, firstName: true, tags: true },
    }),
    db.lead.findFirst({
      where: { phone: { contains: last10 } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, firstName: true, customerId: true },
    }),
  ]);

  return { customer, lead };
}

export type InboundSmsResult = {
  handled: 'opt_out' | 'opt_in' | 'message';
  conversationId: string;
  cancelledRuns: number;
};

export async function handleInboundSms(input: {
  organizationId: string;
  from: string;
  to: string;
  body: string;
  providerMessageId?: string | null;
}): Promise<InboundSmsResult> {
  const db = forOrganization(input.organizationId);
  const { customer, lead } = await identify(db, input.from);

  const conversationId = await findOrCreateConversation(db, input.organizationId, {
    channel: Channel.SMS,
    contact: input.from,
    customerId: customer?.id ?? lead?.customerId ?? null,
    leadId: lead?.id ?? null,
  });

  const now = new Date();

  // Recorded before anything is interpreted, so even a message we then act on
  // automatically is visible in the thread exactly as the customer sent it.
  await db.message.create({
    data: {
      organizationId: input.organizationId,
      conversationId,
      channel: Channel.SMS,
      direction: MessageDirection.INBOUND,
      status: MessageStatus.RECEIVED,
      fromAddress: input.from,
      toAddress: input.to,
      body: input.body,
      providerMessageId: input.providerMessageId ?? null,
      sentAt: now,
    },
  });

  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: now, unreadCount: { increment: 1 }, archived: false },
  });

  // ── Opt-out ───────────────────────────────────────────────────────────────
  if (isOptOut(input.body)) {
    if (customer) {
      await db.customer.update({
        where: { id: customer.id },
        data: { tags: { set: [...new Set([...customer.tags, OPTED_OUT_TAG])] } },
      });
    }

    // Everything aimed at them stops, not just the sequence they replied to.
    const cancelled = customer
      ? await cancelRunsForCustomer(db, customer.id, { reason: 'customer opted out' })
      : lead
        ? await cancelRuns(db, { type: 'lead', id: lead.id }, { reason: 'customer opted out' })
        : 0;

    // Sent directly rather than through sendMessage, which would (correctly)
    // refuse to text a number that has just opted out. Carriers expect this one
    // acknowledgement and it is the last message they will get.
    try {
      const result = await sendSms({ to: input.from, body: OPT_OUT_CONFIRMATION });

      await db.message.create({
        data: {
          organizationId: input.organizationId,
          conversationId,
          channel: Channel.SMS,
          direction: MessageDirection.OUTBOUND,
          status: result.delivered ? MessageStatus.SENT : MessageStatus.QUEUED,
          toAddress: input.from,
          body: OPT_OUT_CONFIRMATION,
          providerMessageId: result.providerMessageId,
          sentAt: result.delivered ? new Date() : null,
        },
      });

      if (result.delivered) {
        await recordUsage(db, input.organizationId, UsageMetric.SMS_SENT);
      }
    } catch (error) {
      // The opt-out itself is already recorded, which is the part that matters
      // legally. A failed confirmation is worth logging, not worth undoing it.
      console.error('[inbound] could not send the opt-out confirmation', error);
    }

    await db.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: null,
        type: 'sms.opted_out',
        title: `${customer?.firstName ?? lead?.firstName ?? input.from} has opted out of texts`,
        href: customer ? `/customers/${customer.id}` : null,
      },
    });

    return { handled: 'opt_out', conversationId, cancelledRuns: cancelled };
  }

  // ── Opt-in ────────────────────────────────────────────────────────────────
  if (isOptIn(input.body) && customer && customer.tags.includes(OPTED_OUT_TAG)) {
    await db.customer.update({
      where: { id: customer.id },
      data: { tags: { set: customer.tags.filter((tag) => tag !== OPTED_OUT_TAG) } },
    });

    try {
      await sendSms({ to: input.from, body: OPT_IN_CONFIRMATION });
    } catch (error) {
      console.error('[inbound] could not send the opt-in confirmation', error);
    }

    return { handled: 'opt_in', conversationId, cancelledRuns: 0 };
  }

  // ── An ordinary reply ─────────────────────────────────────────────────────
  //
  // The customer is engaged, so every automated chase aimed at them stops here.
  // This is the behaviour that separates a system that looks attentive from one
  // that looks like a robot.
  const cancelled = customer
    ? await cancelRunsForCustomer(db, customer.id, { reason: 'customer replied' })
    : lead
      ? await cancelRuns(db, { type: 'lead', id: lead.id }, { reason: 'customer replied' })
      : 0;

  if (lead) {
    await db.lead.update({
      where: { id: lead.id },
      data: { lastContactedAt: now },
    });
  }

  await db.notification.create({
    data: {
      organizationId: input.organizationId,
      userId: null,
      type: 'sms.received',
      title: `New text from ${customer?.firstName ?? lead?.firstName ?? input.from}`,
      body: input.body.slice(0, 200),
      href: `/messages/${conversationId}`,
    },
  });

  return { handled: 'message', conversationId, cancelledRuns: cancelled };
}

export type MissedCallResult = {
  leadId: string | null;
  conversationId: string;
  textedBack: boolean;
};

/**
 * A call nobody answered.
 *
 * The whole value is in the speed: a lead row, a thread, and a text back before
 * the caller has finished dialling the next company. The lead is created even if
 * the text fails, because knowing someone rang is worth more than the text.
 */
export async function handleMissedCall(input: {
  organizationId: string;
  from: string;
  to: string;
}): Promise<MissedCallResult> {
  const db = forOrganization(input.organizationId);
  const { customer, lead } = await identify(db, input.from);

  const conversationId = await findOrCreateConversation(db, input.organizationId, {
    channel: Channel.SMS,
    contact: input.from,
    customerId: customer?.id ?? null,
    leadId: lead?.id ?? null,
  });

  let leadId = lead?.id ?? null;

  // A caller we already know does not need a duplicate lead; a stranger does.
  if (!leadId && !customer) {
    const created = await createLead(
      db,
      input.organizationId,
      {
        firstName: 'Missed call',
        phone: input.from,
        source: LeadSource.MISSED_CALL,
        description: `Missed call from ${input.from}. Texted back automatically.`,
      },
      // No actor: this was the phone network, not a person.
      null,
    );

    leadId = created.id;
    await recordUsage(db, input.organizationId, UsageMetric.LEADS);

    await db.conversation.update({
      where: { id: conversationId },
      data: { leadId },
    });
  }

  await db.notification.create({
    data: {
      organizationId: input.organizationId,
      userId: null,
      type: 'call.missed',
      title: `Missed call from ${input.from}`,
      body: 'They have been texted back automatically.',
      href: leadId ? `/leads/${leadId}` : `/messages/${conversationId}`,
    },
  });

  // The text itself is an automation, so an owner can edit its wording and turn
  // it off — rather than being hard-coded here where they cannot reach it.
  const subject: AutomationSubject = leadId
    ? { type: 'lead', id: leadId }
    : { type: 'customer', id: customer!.id };

  const started = await fireTrigger(
    db,
    input.organizationId,
    AutomationTrigger.MISSED_CALL,
    subject,
  );

  if (started === 0) return { leadId, conversationId, textedBack: false };

  /*
   * Sent now, not on the next scheduled pass.
   *
   * The entire claim of this feature is that the homeowner gets a text before
   * they have finished dialling the next company. Leaving a zero-delay step to
   * the cron would make that "within the next minute", which is long enough for
   * the competitor to have answered.
   *
   * Safe to do inline even though it is on Twilio's request path:
   *  - the run is claimed with the same conditional update the scheduled worker
   *    uses, so the two cannot both send it;
   *  - if this request is slow enough for Twilio to time out and retry, the retry
   *    creates no second lead (the caller is now a known one) and fires no second
   *    trigger (the unique index makes it idempotent);
   *  - a throw here would lose the lead we just recorded, so it is contained. The
   *    scheduled pass is the fallback, and the run is still PENDING for it.
   */
  let textedBack = false;

  try {
    const report = await runDueAutomations({ subject, limit: 1 });
    textedBack = report.completed + report.advanced > 0;
  } catch (error) {
    console.error('[inbound] could not text back immediately; leaving it to the worker', error);
  }

  return { leadId, conversationId, textedBack };
}
