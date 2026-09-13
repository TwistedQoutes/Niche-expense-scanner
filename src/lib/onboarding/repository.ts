import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import type { TenantClient } from '@/lib/db/tenant';
import { templatesForIndustry } from '@/lib/services/templates';

/**
 * Setting a workspace up.
 *
 * The wizard writes the same fields Settings does — it is a guided path through
 * them, not a separate store. That matters: an owner who skips onboarding and
 * fills Settings in by hand ends up in exactly the same state, and nothing later
 * depends on which route they took.
 */

/**
 * Switches the workspace's trade, and its starter catalogue with it.
 *
 * The catalogue is only **replaced when nothing has been done with it yet**. Once
 * a service has been priced by hand, used on a quote, or renamed, it is the
 * owner's work and not ours to overwrite — somebody who picked "lawn care" by
 * mistake on Tuesday and fixes it on Friday must not lose Wednesday's pricing.
 *
 * Returns what happened so the wizard can say so rather than silently doing one
 * thing or the other.
 */
export async function setIndustry(
  db: TenantClient,
  organizationId: string,
  industry: string,
): Promise<{ installed: number; keptExisting: boolean }> {
  const existing = await db.service.findMany({
    select: { id: true, templateKey: true, quoteItems: { select: { id: true }, take: 1 } },
  });

  const untouched =
    existing.length === 0 ||
    existing.every((service) => service.templateKey !== null && service.quoteItems.length === 0);

  await prisma.organization.update({ where: { id: organizationId }, data: { industry } });

  if (!untouched) return { installed: 0, keptExisting: true };

  const templates = templatesForIndustry(industry);

  /*
   * Replaced rather than merged. Merging would leave a pressure-washing workspace
   * holding lawn-mowing services it never asked for, and "delete the ones you do
   * not want" is work we created for them.
   */
  if (existing.length > 0) {
    await db.service.deleteMany({ where: { id: { in: existing.map((service) => service.id) } } });
  }

  if (templates.length === 0) return { installed: 0, keptExisting: false };

  const data: Prisma.ServiceCreateManyInput[] = templates.map((template, index) => ({
    organizationId,
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
  }));

  await db.service.createMany({ data });

  return { installed: data.length, keptExisting: false };
}

export type OnboardingState = {
  onboarded: boolean;
  industry: string;
  hasPhone: boolean;
  hasReviewUrl: boolean;
  timezone: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  reviewUrl: string | null;
  defaultLaborRateCents: number;
  defaultProfitMarginBps: number;
  defaultMinimumJobCents: number;
  services: number;
};

/** What the wizard needs to show, and what is already answered. */
export async function loadOnboardingState(
  db: TenantClient,
  organizationId: string,
): Promise<OnboardingState> {
  const [organization, services] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        onboardedAt: true,
        industry: true,
        phone: true,
        timezone: true,
        city: true,
        state: true,
        reviewUrl: true,
        defaultLaborRateCents: true,
        defaultProfitMarginBps: true,
        defaultMinimumJobCents: true,
      },
    }),
    db.service.count(),
  ]);

  if (!organization) throw new Error('The signed-in workspace no longer exists.');

  return {
    onboarded: organization.onboardedAt !== null,
    industry: organization.industry,
    hasPhone: Boolean(organization.phone),
    hasReviewUrl: Boolean(organization.reviewUrl),
    timezone: organization.timezone,
    city: organization.city,
    state: organization.state,
    phone: organization.phone,
    reviewUrl: organization.reviewUrl,
    defaultLaborRateCents: organization.defaultLaborRateCents,
    defaultProfitMarginBps: organization.defaultProfitMarginBps,
    defaultMinimumJobCents: organization.defaultMinimumJobCents,
    services,
  };
}

/**
 * Marks the workspace set up.
 *
 * Idempotent, and it keeps the **first** timestamp: re-running the wizard to
 * change an answer is allowed, and it should not reset when the business started.
 */
export async function markOnboarded(organizationId: string): Promise<void> {
  await prisma.organization.updateMany({
    where: { id: organizationId, onboardedAt: null },
    data: { onboardedAt: new Date() },
  });
}
