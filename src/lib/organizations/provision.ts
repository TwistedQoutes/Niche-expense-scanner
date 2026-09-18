import { randomBytes } from 'node:crypto';

import {
  AutomationActionType,
  AutomationTrigger,
  MembershipStatus,
  PlanTier,
  Role,
  SubscriptionStatus,
} from '@prisma/client';
import type { Prisma, PrismaClient } from '@prisma/client';

import { getEnv } from '@/lib/env';
import { templatesForIndustry } from '@/lib/services/templates';

/**
 * Turning a signup into a working business account.
 *
 * A new workspace that contains nothing is not a product — the owner lands on
 * an empty dashboard with no services, so they cannot build a quote, so they
 * never reach the thing they signed up for. Provisioning therefore creates the
 * whole starting state in one transaction: the business, its owner's
 * membership, a trial subscription, the service catalogue for its trade, and
 * the follow-up automations that do the work the product promises.
 *
 * It is one transaction on purpose. A half-provisioned organization — a
 * business row with no membership, say — is unreachable by the person who just
 * paid attention to sign up for it, and unrecoverable without support.
 */

/** URL-safe handle from a business name: "Green & Co Lawns" → "green-co-lawns". */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    // Strip combining marks so "Küche" becomes "kuche" rather than "kche".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

  // A name of nothing but punctuation would otherwise produce an empty slug,
  // and an empty slug collides with every other empty slug.
  return base.length >= 2 ? base : `workspace-${randomBytes(3).toString('hex')}`;
}

/**
 * The starter automations.
 *
 * These are the product's actual promise — "follow up automatically" — so they
 * are on by default rather than something the owner has to discover. The timing
 * matches the documented sequence: day 2, day 5, day 10, then tell the owner.
 */
const STARTER_AUTOMATIONS: {
  templateKey: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  steps: {
    position: number;
    delayMinutes: number;
    action: AutomationActionType;
    subject?: string;
    template?: string;
    config?: Prisma.InputJsonValue;
  }[];
}[] = [
  {
    templateKey: 'quote_follow_up',
    name: 'Quote follow-up',
    description:
      'Nudges a customer who has not answered a quote, then hands it back to you on day 10.',
    trigger: AutomationTrigger.QUOTE_SENT,
    steps: [
      {
        position: 0,
        delayMinutes: 60 * 24 * 2,
        action: AutomationActionType.SEND_SMS,
        template:
          'Hi {{first_name}}, just checking in about the {{service}} estimate we sent for {{address}}. Happy to answer any questions — reply here any time. – {{business_name}}',
        config: { personalise: true },
      },
      {
        position: 1,
        delayMinutes: 60 * 24 * 3,
        action: AutomationActionType.SEND_EMAIL,
        subject: 'Your {{service}} estimate from {{business_name}}',
        template:
          'Hi {{first_name}},\n\nYour estimate is still open and you can review it here:\n{{quote_url}}\n\nIf anything about it needs changing, just reply to this email and we will sort it out.\n\nThanks,\n{{business_name}}',
        config: { personalise: true },
      },
      {
        position: 2,
        delayMinutes: 60 * 24 * 5,
        action: AutomationActionType.SEND_SMS,
        template:
          'Hi {{first_name}}, last check-in on the {{service}} estimate for {{address}} before it expires. Want us to hold the price? – {{business_name}}',
        config: { personalise: true },
      },
      {
        position: 3,
        delayMinutes: 0,
        action: AutomationActionType.NOTIFY_OWNER,
        template: '{{first_name}} has not responded to quote {{quote_number}} after three touches.',
      },
    ],
  },
  {
    templateKey: 'review_request',
    name: 'Review request',
    description: 'Asks for a review a few hours after a job is marked complete.',
    trigger: AutomationTrigger.JOB_COMPLETED,
    steps: [
      {
        position: 0,
        // Not immediate: a request that arrives while the crew is still packing
        // up reads as automated, and the customer has not seen the result yet.
        delayMinutes: 60 * 3,
        action: AutomationActionType.REQUEST_REVIEW,
        template:
          'Thanks for choosing {{business_name}}, {{first_name}}! We hope you are happy with the {{service}}. If you have 30 seconds, a review really helps us: {{review_url}}',
      },
    ],
  },
  {
    templateKey: 'customer_reactivation',
    name: 'Repeat customer reminder',
    description: 'Brings past customers back when their service is due again.',
    trigger: AutomationTrigger.CUSTOMER_INACTIVE,
    steps: [
      {
        position: 0,
        delayMinutes: 60 * 24 * 30,
        action: AutomationActionType.SEND_SMS,
        template:
          'Hi {{first_name}}, ready for your next {{service}}? We have openings this week — reply YES and we will book you in. – {{business_name}}',
        config: { personalise: true },
      },
      {
        position: 1,
        delayMinutes: 60 * 24 * 30,
        action: AutomationActionType.SEND_EMAIL,
        subject: 'Time for another {{service}}?',
        template:
          'Hi {{first_name}},\n\nIt has been a couple of months since we were last at {{address}}. If you would like to get back on the schedule, just reply and we will find a slot.\n\n{{business_name}}',
        config: { personalise: true },
      },
    ],
  },
  {
    templateKey: 'missed_call_text_back',
    name: 'Missed-call text back',
    description: 'Texts anyone whose call you could not take, within seconds.',
    trigger: AutomationTrigger.MISSED_CALL,
    steps: [
      {
        position: 0,
        // Immediate by design: this is the feature that stops a missed call
        // becoming a competitor's job.
        delayMinutes: 0,
        action: AutomationActionType.SEND_SMS,
        template:
          'Hi! Sorry we missed your call. This is {{business_name}}. How can we help?',
      },
    ],
  },
];

export type ProvisionInput = {
  businessName: string;
  ownerName: string;
  email: string;
  phone?: string | null;
  industry?: string;
  /** Marks the seeded sample workspace. */
  isDemo?: boolean;
};

/**
 * Creates the organization and everything a new one needs, then returns it.
 *
 * `tx` is the transaction client from the caller, so signup can create the user
 * and the workspace atomically.
 */
export async function provisionOrganization(
  tx: Prisma.TransactionClient | PrismaClient,
  userId: string,
  input: ProvisionInput,
) {
  const industry = input.industry ?? 'lawn_care';
  const trialDays = getEnv().TRIAL_DAYS;

  const organization = await tx.organization.create({
    data: {
      // The random suffix is not decoration. Two landscapers both called
      // "Green Thumb" is the common case, not the edge case, and a slug
      // collision at signup would reject the second one's account.
      slug: `${slugify(input.businessName)}-${randomBytes(3).toString('hex')}`,
      name: input.businessName,
      ownerName: input.ownerName,
      email: input.email,
      phone: input.phone ?? null,
      industry,
      isDemo: input.isDemo ?? false,
    },
    select: { id: true, slug: true, name: true },
  });

  await tx.membership.create({
    data: {
      userId,
      organizationId: organization.id,
      role: Role.OWNER,
      status: MembershipStatus.ACTIVE,
      acceptedAt: new Date(),
    },
  });

  await tx.subscription.create({
    data: {
      organizationId: organization.id,
      // The trial grants PRO features without a card. A business cannot judge
      // whether automated follow-up is worth $99 from a plan that does not
      // include it, and that judgement is the entire sales pitch.
      plan: trialDays > 0 ? PlanTier.PRO : PlanTier.FREE,
      status: trialDays > 0 ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
      trialEndsAt: trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000) : null,
    },
  });

  const templates = templatesForIndustry(industry);
  if (templates.length > 0) {
    await tx.service.createMany({
      data: templates.map((template, index) => ({
        organizationId: organization.id,
        templateKey: template.key,
        name: template.name,
        description: template.description,
        basePriceCents: template.basePriceCents,
        minimumPriceCents: template.minimumPriceCents,
        unitPriceCents: template.unitPriceCents,
        unitSizeSqFt: template.unitSizeSqFt,
        estimatedMinutes: template.estimatedMinutes,
        materialCostCents: template.materialCostCents,
        taxable: template.taxable,
        position: index,
      })),
    });
  }

  // Automations are created one at a time rather than with createMany, because
  // each needs its steps attached to the id the insert returns.
  for (const automation of STARTER_AUTOMATIONS) {
    await tx.automation.create({
      data: {
        organizationId: organization.id,
        templateKey: automation.templateKey,
        name: automation.name,
        description: automation.description,
        trigger: automation.trigger,
        // Off until the channel exists. An automation that "ran" and silently
        // sent nothing because Twilio was never configured is worse than one
        // the owner switches on deliberately in Settings.
        enabled: false,
        steps: {
          create: automation.steps.map((step) => ({
            position: step.position,
            delayMinutes: step.delayMinutes,
            action: step.action,
            subject: step.subject ?? null,
            template: step.template ?? null,
            ...(step.config === undefined ? {} : { config: step.config }),
          })),
        },
      },
    });
  }

  return organization;
}
