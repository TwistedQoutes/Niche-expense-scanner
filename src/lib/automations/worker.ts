import {
  AutomationActionType,
  AutomationRunStatus,
  Channel,
  LeadStatus,
  ReviewRequestStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/db/client';
import { forOrganization, type TenantClient } from '@/lib/db/tenant';
import { getEnv } from '@/lib/env';
import { renderTemplate, type TemplateValues } from '@/lib/messaging/templates';
import { sendMessage } from '@/lib/messaging/send';
import { formatCents } from '@/lib/money';

/**
 * The automation worker.
 *
 * Called from `/api/cron/automations` on a schedule. It claims runs whose
 * `runAt` has passed, performs one step each, and re-arms the row for the next
 * one. One step per pass rather than draining a whole sequence, because a
 * sequence's steps are separated by days by design — advancing two in one pass
 * would collapse a three-day gap into three seconds.
 *
 * Three properties this has to hold:
 *
 *  - **Nothing is sent twice.** A run is claimed by a conditional update, so two
 *    overlapping cron invocations cannot both act on it.
 *  - **One failure does not stop the queue.** Each run is isolated; a customer
 *    with a dead phone number must not block everyone else's follow-ups.
 *  - **A run that cannot proceed ends.** A lead that was deleted, an automation
 *    that was emptied — those complete rather than retrying forever.
 */

/** How many runs one invocation will process. Bounded to fit a serverless budget. */
const BATCH_SIZE = 25;

/** Attempts before a run is abandoned, so a permanent failure stops costing money. */
const MAX_ATTEMPTS = 3;

export type WorkerReport = {
  claimed: number;
  completed: number;
  advanced: number;
  failed: number;
  skipped: number;
};

/**
 * The data a step's template can refer to, gathered from whatever the run is
 * about.
 *
 * Returns null when the subject has gone — the caller completes the run rather
 * than retrying against a record that will never come back.
 */
async function loadContext(
  db: TenantClient,
  organizationId: string,
  subjectType: string,
  subjectId: string,
): Promise<
  | {
      values: TemplateValues;
      phone: string | null;
      email: string | null;
      customerId: string | null;
      leadId: string | null;
      jobId: string | null;
    }
  | null
> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, phone: true, reviewUrl: true, currency: true },
  });
  if (!organization) return null;

  const base: TemplateValues = {
    business_name: organization.name,
    business_phone: organization.phone,
    review_url: organization.reviewUrl,
  };

  const appUrl = getEnv().APP_URL.replace(/\/+$/, '');

  if (subjectType === 'quote') {
    const quote = await db.quote.findUnique({
      where: { id: subjectId },
      select: {
        number: true,
        publicId: true,
        totalCents: true,
        currency: true,
        title: true,
        leadId: true,
        customerId: true,
        customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, addressLine1: true } },
        lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, addressLine1: true, serviceRequested: true } },
        items: { select: { name: true }, orderBy: { position: 'asc' }, take: 1 },
      },
    });
    if (!quote) return null;

    const person = quote.customer ?? quote.lead;

    return {
      values: {
        ...base,
        first_name: person?.firstName ?? null,
        last_name: person?.lastName ?? null,
        full_name: [person?.firstName, person?.lastName].filter(Boolean).join(' ') || null,
        service: quote.title ?? quote.items[0]?.name ?? quote.lead?.serviceRequested ?? null,
        address: person?.addressLine1 ?? null,
        quote_number: quote.number,
        quote_url: `${appUrl}/quote/${quote.publicId}`,
        quote_total: formatCents(quote.totalCents, quote.currency || organization.currency),
      },
      phone: person?.phone ?? null,
      email: person?.email ?? null,
      customerId: quote.customerId,
      leadId: quote.leadId,
      jobId: null,
    };
  }

  if (subjectType === 'job') {
    const job = await db.job.findUnique({
      where: { id: subjectId },
      select: {
        number: true,
        title: true,
        customerId: true,
        customer: {
          select: { firstName: true, lastName: true, email: true, phone: true, addressLine1: true },
        },
      },
    });
    if (!job) return null;

    return {
      values: {
        ...base,
        first_name: job.customer.firstName,
        last_name: job.customer.lastName,
        full_name: [job.customer.firstName, job.customer.lastName].filter(Boolean).join(' ') || null,
        service: job.title,
        address: job.customer.addressLine1,
        job_number: job.number,
      },
      phone: job.customer.phone,
      email: job.customer.email,
      customerId: job.customerId,
      leadId: null,
      jobId: subjectId,
    };
  }

  if (subjectType === 'lead') {
    const lead = await db.lead.findUnique({
      where: { id: subjectId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        addressLine1: true,
        serviceRequested: true,
        customerId: true,
      },
    });
    if (!lead) return null;

    return {
      values: {
        ...base,
        first_name: lead.firstName,
        last_name: lead.lastName,
        full_name: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || null,
        service: lead.serviceRequested,
        address: lead.addressLine1,
      },
      phone: lead.phone,
      email: lead.email,
      customerId: lead.customerId,
      leadId: subjectId,
      jobId: null,
    };
  }

  // customer
  const customer = await db.customer.findUnique({
    where: { id: subjectId },
    select: { firstName: true, lastName: true, email: true, phone: true, addressLine1: true },
  });
  if (!customer) return null;

  return {
    values: {
      ...base,
      first_name: customer.firstName,
      last_name: customer.lastName,
      full_name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || null,
      address: customer.addressLine1,
    },
    phone: customer.phone,
    email: customer.email,
    customerId: subjectId,
    leadId: null,
    jobId: null,
  };
}

type StepRecord = {
  position: number;
  delayMinutes: number;
  action: AutomationActionType;
  subject: string | null;
  template: string | null;
  config: unknown;
};

/** Performs one step. Throws to mark the run failed; returns to advance it. */
async function performStep(
  db: TenantClient,
  organizationId: string,
  subscription: Parameters<typeof sendMessage>[1],
  run: { id: string; subjectType: string; subjectId: string },
  step: StepRecord,
): Promise<void> {
  const context = await loadContext(db, organizationId, run.subjectType, run.subjectId);

  // The record this run is about has gone. Treated as done, not failed: there is
  // nothing to retry against.
  if (!context) return;

  const rendered = step.template ? renderTemplate(step.template, context.values) : null;
  const subject = step.subject ? renderTemplate(step.subject, context.values).text : null;

  switch (step.action) {
    case AutomationActionType.SEND_SMS: {
      if (!context.phone || !rendered) return;

      const outcome = await sendMessage(db, subscription, {
        organizationId,
        channel: Channel.SMS,
        to: context.phone,
        body: rendered.text,
        customerId: context.customerId,
        leadId: context.leadId,
      });

      /*
       * An opt-out or a spent allowance is not a failure of this run — it is a
       * correct refusal, and retrying it would waste attempts to reach the same
       * answer. A provider failure is worth another go.
       */
      if (!outcome.ok && outcome.reason === 'failed') {
        throw new Error(outcome.message);
      }
      return;
    }

    case AutomationActionType.SEND_EMAIL: {
      if (!context.email || !rendered) return;

      const outcome = await sendMessage(db, subscription, {
        organizationId,
        channel: Channel.EMAIL,
        to: context.email,
        subject: subject ?? 'A message about your job',
        body: rendered.text,
        customerId: context.customerId,
        leadId: context.leadId,
      });

      if (!outcome.ok && outcome.reason === 'failed') {
        throw new Error(outcome.message);
      }
      return;
    }

    case AutomationActionType.NOTIFY_OWNER: {
      await db.notification.create({
        data: {
          organizationId,
          userId: null,
          type: 'automation.notify',
          title: rendered?.text.slice(0, 200) ?? 'An automation needs your attention',
          href: context.leadId ? `/leads/${context.leadId}` : null,
        },
      });
      return;
    }

    case AutomationActionType.REQUEST_REVIEW: {
      if (!context.customerId) return;

      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { reviewUrl: true },
      });

      /*
       * No review URL means there is nowhere to send them. Skipped silently
       * rather than sending a message with a dead link in it — a review request
       * pointing nowhere is worse than none, because the customer tried.
       */
      if (!organization?.reviewUrl) return;

      // The token is the tracked redirect's credential, so it is random for the
      // same reason a quote's public id is.
      const token = randomBytes(16).toString('base64url');

      await db.reviewRequest.create({
        data: {
          organizationId,
          customerId: context.customerId,
          jobId: context.jobId,
          channel: Channel.SMS,
          status: ReviewRequestStatus.PENDING,
          token,
          reviewUrl: organization.reviewUrl,
        },
      });

      if (!context.phone || !rendered) return;

      const appUrl = getEnv().APP_URL.replace(/\/+$/, '');
      const body = renderTemplate(step.template ?? '', {
        ...context.values,
        review_url: `${appUrl}/r/${token}`,
      }).text;

      const outcome = await sendMessage(db, subscription, {
        organizationId,
        channel: Channel.SMS,
        to: context.phone,
        body,
        customerId: context.customerId,
      });

      if (outcome.ok) {
        await db.reviewRequest.updateMany({
          where: { token },
          data: { status: ReviewRequestStatus.SENT, sentAt: new Date() },
        });
      } else if (outcome.reason === 'failed') {
        await db.reviewRequest.updateMany({
          where: { token },
          data: { status: ReviewRequestStatus.FAILED },
        });
        throw new Error(outcome.message);
      }
      return;
    }

    case AutomationActionType.CHANGE_LEAD_STATUS: {
      if (!context.leadId) return;

      const config = (step.config ?? {}) as { status?: string };
      const target = config.status;

      // Validated against the enum: a typo in a config blob must not write
      // nonsense into a column the pipeline board reads.
      if (!target || !(target in LeadStatus)) return;

      await db.lead.update({
        where: { id: context.leadId },
        data: { status: target as LeadStatus },
      });
      return;
    }

    case AutomationActionType.CREATE_TASK: {
      // Tasks are not a model yet, so this records a notification instead of
      // pretending to have created something. Named honestly in the type.
      await db.notification.create({
        data: {
          organizationId,
          userId: null,
          type: 'automation.task',
          title: rendered?.text.slice(0, 200) ?? 'Automation task',
          href: context.leadId ? `/leads/${context.leadId}` : null,
        },
      });
      return;
    }

    default:
      return;
  }
}

/**
 * Processes one batch of due runs across every organization.
 *
 * The claim query is global rather than per-tenant — the worker is not acting for
 * a signed-in user — but each run is then executed through a tenant client
 * pinned to its own organization, so a step cannot touch anyone else's data.
 */
export async function runDueAutomations(
  options: {
    now?: Date;
    limit?: number;
    /**
     * Narrows the pass to one subject.
     *
     * Used to run a zero-delay step immediately instead of waiting for the next
     * scheduled pass — see the missed-call path in `messaging/inbound.ts`. The
     * claim below is the same, so an inline pass and a scheduled one cannot both
     * take the same run.
     */
    subject?: { type: string; id: string };
  } = {},
): Promise<WorkerReport> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? BATCH_SIZE;

  const due = await prisma.automationRun.findMany({
    where: {
      status: AutomationRunStatus.PENDING,
      runAt: { lte: now },
      ...(options.subject
        ? { subjectType: options.subject.type, subjectId: options.subject.id }
        : {}),
    },
    orderBy: { runAt: 'asc' },
    take: limit,
    select: { id: true, organizationId: true, automationId: true, subjectType: true, subjectId: true, currentStep: true, attempts: true },
  });

  const report: WorkerReport = { claimed: 0, completed: 0, advanced: 0, failed: 0, skipped: 0 };

  for (const run of due) {
    /*
     * Claim it. The `status: PENDING` in the where clause is the lock: if a
     * second invocation already moved this row to RUNNING, this update matches
     * nothing and we skip it. Without that, two overlapping crons would both
     * text the same customer.
     */
    const claimed = await prisma.automationRun.updateMany({
      where: { id: run.id, status: AutomationRunStatus.PENDING },
      data: { status: AutomationRunStatus.RUNNING, startedAt: now, attempts: { increment: 1 } },
    });

    if (claimed.count === 0) {
      report.skipped += 1;
      continue;
    }

    report.claimed += 1;
    const db = forOrganization(run.organizationId);

    try {
      const automation = await db.automation.findUnique({
        where: { id: run.automationId },
        select: {
          enabled: true,
          steps: {
            orderBy: { position: 'asc' },
            select: {
              position: true,
              delayMinutes: true,
              action: true,
              subject: true,
              template: true,
              config: true,
            },
          },
        },
      });

      const step = automation?.steps[run.currentStep];

      // Switched off mid-sequence, or the steps were edited out from under it.
      // Either way this run has nothing left to do.
      if (!automation?.enabled || !step) {
        await prisma.automationRun.update({
          where: { id: run.id },
          data: { status: AutomationRunStatus.COMPLETED, completedAt: new Date() },
        });
        report.completed += 1;
        continue;
      }

      const organization = await prisma.organization.findUnique({
        where: { id: run.organizationId },
        select: { subscription: { select: { plan: true, status: true, trialEndsAt: true } } },
      });

      await performStep(db, run.organizationId, organization?.subscription ?? null, run, step);

      const nextStep = automation.steps[run.currentStep + 1];

      if (!nextStep) {
        await prisma.automationRun.update({
          where: { id: run.id },
          data: { status: AutomationRunStatus.COMPLETED, completedAt: new Date(), lastError: null },
        });
        report.completed += 1;
      } else {
        await prisma.automationRun.update({
          where: { id: run.id },
          data: {
            status: AutomationRunStatus.PENDING,
            currentStep: run.currentStep + 1,
            runAt: new Date(Date.now() + nextStep.delayMinutes * 60_000),
            lastError: null,
          },
        });
        report.advanced += 1;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The step failed.';
      const attempts = run.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;

      // Isolated on purpose: one customer's dead phone number must not stop
      // everyone else's follow-ups from going out.
      console.error('[automations] step failed', { runId: run.id, attempts, error });

      await prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: giveUp ? AutomationRunStatus.FAILED : AutomationRunStatus.PENDING,
          // Backs off: 5 minutes, then 25.
          runAt: giveUp ? undefined : new Date(Date.now() + attempts * 5 * 60_000),
          completedAt: giveUp ? new Date() : null,
          lastError: detail.slice(0, 500),
        },
      });

      report.failed += 1;
    }
  }

  return report;
}
