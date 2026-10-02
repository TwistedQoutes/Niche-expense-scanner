import { MembershipStatus, Role } from '@prisma/client';

import type { TenantClient } from '@/lib/db/tenant';
import { pushEnabled } from '@/lib/push';
import { pushToUsers } from '@/lib/push/devices';

/**
 * The notifications the apps actually send.
 *
 * Deliberately a short list. A phone that buzzes for everything gets its
 * notifications switched off within a week, and then the one that mattered —
 * a new lead at 7am — is never seen either. Each entry here has to be worth
 * interrupting someone's morning for.
 */

/**
 * What a new-lead notification says under the title.
 *
 * Exported for its own sake: lock screens truncate, and the rule for where to
 * cut is the kind of thing that quietly regresses. A notification that ends
 * mid-word reads as a broken app rather than a long enquiry.
 */
export function leadNotificationBody(name: string, description: string | null): string {
  const detail = (description ?? '').replace(/\s+/g, ' ').trim();

  if (detail.length === 0) return `${name} just came in. Tap to see the details.`;
  if (detail.length <= 110) return detail;

  // Cut at the last word boundary inside the budget, so the ellipsis follows a
  // whole word. A description with no spaces at all (a pasted URL) falls back
  // to a hard cut rather than losing everything.
  const clipped = detail.slice(0, 107);
  const atWord = clipped.replace(/\s+\S*$/, '');
  return `${atWord.length > 0 ? atWord : clipped}\u2026`;
}

/** Who handles new work: the owner and any admins. Crew do not chase leads. */
async function salesUserIds(db: TenantClient): Promise<string[]> {
  const memberships = await db.membership.findMany({
    where: { status: MembershipStatus.ACTIVE, role: { in: [Role.OWNER, Role.ADMIN] } },
    select: { userId: true },
  });
  return memberships.map((membership) => membership.userId);
}

/**
 * A new enquiry arrived.
 *
 * This is the product's reason for existing on a phone. The body carries the
 * customer's name and what they want, because a notification that says only
 * "You have a new lead" makes someone unlock the phone to learn whether it was
 * worth unlocking the phone.
 *
 * Never throws. It is called after the lead is already saved, and a push
 * provider having a bad morning must not turn a captured lead into an error the
 * caller sees.
 */
export async function notifyNewLead(
  db: TenantClient,
  lead: { id: string; firstName: string; lastName: string | null },
): Promise<void> {
  if (!pushEnabled()) return;

  try {
    const recipients = await salesUserIds(db);
    if (recipients.length === 0) return;

    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || 'Someone';

    // Read here rather than taken as an argument. The card select the create
    // path returns is what the pipeline board needs, and widening it to carry a
    // description would add a column to every list query in the product to
    // serve one notification. This is a primary-key read on a path that is
    // already fire-and-forget.
    const row = await db.lead.findUnique({
      where: { id: lead.id },
      select: { description: true },
    });

    const body = leadNotificationBody(name, row?.description ?? null);

    await pushToUsers(db, recipients, {
      title: `New lead: ${name}`,
      body,
      path: `/leads/${lead.id}`,
      // One line on the lock screen however many arrive while the phone is in a
      // pocket. Whoever picks it up opens the pipeline, not six notifications.
      collapseKey: 'new-lead',
    });
  } catch (error) {
    console.error('[push] could not announce a new lead', {
      leadId: lead.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

/**
 * A job was assigned to someone.
 *
 * Goes to that one person rather than the whole workspace — being told about
 * everybody else's schedule is how notifications get muted.
 */
export async function notifyJobAssigned(
  db: TenantClient,
  input: { jobId: string; assigneeId: string; customerName: string; when: string },
): Promise<void> {
  if (!pushEnabled()) return;

  try {
    await pushToUsers(db, [input.assigneeId], {
      title: 'New job on your schedule',
      body: `${input.customerName} — ${input.when}`,
      path: `/jobs/${input.jobId}`,
      collapseKey: `job-${input.jobId}`,
    });
  } catch (error) {
    console.error('[push] could not announce a job assignment', {
      jobId: input.jobId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

/**
 * A customer accepted a quote.
 *
 * The one notification an owner would be annoyed to miss, and the only good
 * news in this file.
 */
export async function notifyQuoteAccepted(
  db: TenantClient,
  input: { quoteId: string; customerName: string; amount: string },
): Promise<void> {
  if (!pushEnabled()) return;

  try {
    const recipients = await salesUserIds(db);
    if (recipients.length === 0) return;

    await pushToUsers(db, recipients, {
      title: 'Quote accepted',
      body: `${input.customerName} accepted ${input.amount}.`,
      path: `/quotes/${input.quoteId}`,
      collapseKey: `quote-${input.quoteId}`,
    });
  } catch (error) {
    console.error('[push] could not announce a quote acceptance', {
      quoteId: input.quoteId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}
