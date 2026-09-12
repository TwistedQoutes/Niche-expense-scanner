import {
  Channel,
  MessageDirection,
  MessageStatus,
  PlanTier,
  UsageMetric,
} from '@prisma/client';

import { effectivePlan, readUsage, recordUsage } from '@/lib/billing/usage';
import type { TenantClient } from '@/lib/db/tenant';
import { sendEmail } from '@/lib/email';
import { hasOptedOut } from '@/lib/messaging/optout';
import { sendSms, SmsError } from '@/lib/sms';

/**
 * Sending a message to a customer, and recording that it happened.
 *
 * Every outbound message in the product goes through here — manual replies from
 * the inbox, automation steps, review requests — so the four things that must
 * never be skipped are in one place and cannot be forgotten by a new call site:
 *
 *  1. **Opt-out is checked first.** Before the plan, before the provider. See
 *     src/lib/messaging/optout.ts for why this one is not negotiable.
 *  2. **The plan's allowance is enforced**, because each message costs money.
 *  3. **A row is written whether or not delivery succeeded.** A failed message
 *     that left no trace is a customer an owner thinks they contacted.
 *  4. **The conversation is threaded**, so the inbox shows one history per person
 *     rather than a pile of sends.
 */

export type SendOutcome =
  | { ok: true; messageId: string; delivered: boolean }
  | {
      ok: false;
      reason: 'opted_out' | 'no_contact' | 'limit' | 'failed';
      message: string;
      /** Written even on failure, when we got far enough to record one. */
      messageId?: string;
    };

export type SendRequest = {
  organizationId: string;
  channel: Channel;
  /** Phone number or email address. */
  to: string;
  body: string;
  subject?: string | null;
  customerId?: string | null;
  leadId?: string | null;
  /** True when a model drafted it, for the audit trail and the UI. */
  aiGenerated?: boolean;
};

const METRIC: Record<'SMS' | 'EMAIL', UsageMetric> = {
  SMS: UsageMetric.SMS_SENT,
  EMAIL: UsageMetric.EMAILS_SENT,
};

/**
 * Finds or creates the thread this message belongs to.
 *
 * Keyed on (organization, channel, contact), which is the same key an inbound
 * webhook matches on — so a reply lands in the thread the outbound message
 * started rather than opening a second one beside it.
 */
export async function findOrCreateConversation(
  db: TenantClient,
  organizationId: string,
  input: {
    channel: Channel;
    contact: string;
    customerId?: string | null;
    leadId?: string | null;
    subject?: string | null;
  },
) {
  const existing = await db.conversation.findFirst({
    where: { channel: input.channel, contact: input.contact },
    select: { id: true, customerId: true, leadId: true },
  });

  if (existing) {
    // Backfill the links if this send knows something the thread did not — a
    // conversation that began as an anonymous text becomes attached to a
    // customer once one exists.
    if (
      (input.customerId && !existing.customerId) ||
      (input.leadId && !existing.leadId)
    ) {
      await db.conversation.update({
        where: { id: existing.id },
        data: {
          customerId: existing.customerId ?? input.customerId ?? null,
          leadId: existing.leadId ?? input.leadId ?? null,
        },
      });
    }
    return existing.id;
  }

  const created = await db.conversation.create({
    data: {
      organizationId,
      channel: input.channel,
      contact: input.contact,
      customerId: input.customerId ?? null,
      leadId: input.leadId ?? null,
      subject: input.subject ?? null,
    },
    select: { id: true },
  });

  return created.id;
}

/** Whether this recipient has asked us to stop. */
async function optedOut(
  db: TenantClient,
  channel: Channel,
  customerId: string | null | undefined,
): Promise<boolean> {
  // Only SMS carries the statutory stop. Email unsubscribe is a separate
  // mechanism and is not implemented yet, so it is not silently claimed here.
  if (channel !== Channel.SMS || !customerId) return false;

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { tags: true },
  });

  return customer ? hasOptedOut(customer.tags) : false;
}

export async function sendMessage(
  db: TenantClient,
  subscription: Parameters<typeof effectivePlan>[0],
  request: SendRequest,
): Promise<SendOutcome> {
  const { organizationId, channel, to, body } = request;

  if (to.trim().length === 0) {
    return { ok: false, reason: 'no_contact', message: 'No phone number or email to send to.' };
  }

  if (await optedOut(db, channel, request.customerId)) {
    return {
      ok: false,
      reason: 'opted_out',
      message: 'That customer has asked not to receive texts.',
    };
  }

  const kind = channel === Channel.SMS ? 'SMS' : 'EMAIL';
  const plan: PlanTier = effectivePlan(subscription);
  const usage = await readUsage(db, plan, METRIC[kind]);

  if (usage.exceeded) {
    return {
      ok: false,
      reason: 'limit',
      message:
        usage.limit === 0
          ? `Your plan does not include ${kind === 'SMS' ? 'text messages' : 'email'}. Upgrade to send them.`
          : `You have used all ${usage.limit} ${kind === 'SMS' ? 'texts' : 'emails'} on your plan this month.`,
    };
  }

  const conversationId = await findOrCreateConversation(db, organizationId, {
    channel,
    contact: to,
    customerId: request.customerId,
    leadId: request.leadId,
    subject: request.subject,
  });

  // Written before the provider is called, so a crash mid-send leaves a QUEUED
  // row an owner can see rather than nothing at all.
  const message = await db.message.create({
    data: {
      organizationId,
      conversationId,
      channel,
      direction: MessageDirection.OUTBOUND,
      status: MessageStatus.QUEUED,
      toAddress: to,
      subject: request.subject ?? null,
      body,
      aiGenerated: request.aiGenerated ?? false,
    },
    select: { id: true },
  });

  try {
    const now = new Date();

    if (channel === Channel.SMS) {
      const result = await sendSms({ to, body });

      await db.message.update({
        where: { id: message.id },
        data: {
          // "none" driver logged it rather than sending. Recorded as SENT is a
          // lie, so it stays QUEUED and the UI can say so.
          status: result.delivered ? MessageStatus.SENT : MessageStatus.QUEUED,
          sentAt: result.delivered ? now : null,
          providerMessageId: result.providerMessageId,
        },
      });

      if (result.delivered) await recordUsage(db, organizationId, UsageMetric.SMS_SENT);
    } else {
      const result = await sendEmail({
        to,
        subject: request.subject ?? 'A message from your contractor',
        text: body,
      });

      await db.message.update({
        where: { id: message.id },
        data: {
          status: result.delivered ? MessageStatus.SENT : MessageStatus.QUEUED,
          sentAt: result.delivered ? now : null,
        },
      });

      if (result.delivered) await recordUsage(db, organizationId, UsageMetric.EMAILS_SENT);
    }

    await db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    });

    return { ok: true, messageId: message.id, delivered: true };
  } catch (error) {
    const detail =
      error instanceof SmsError || error instanceof Error
        ? error.message
        : 'The provider rejected the message.';

    // The failure is recorded on the message, not only in the logs: an owner
    // looking at a conversation needs to see that this one did not arrive.
    await db.message.update({
      where: { id: message.id },
      data: { status: MessageStatus.FAILED, errorMessage: detail.slice(0, 500) },
    });

    console.error('[messaging] send failed', { messageId: message.id, channel, error });

    return {
      ok: false,
      reason: 'failed',
      message: 'That message could not be sent. It is saved in the conversation as failed.',
      messageId: message.id,
    };
  }
}
