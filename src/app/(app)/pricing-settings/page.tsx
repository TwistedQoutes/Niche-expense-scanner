import type { Metadata } from 'next';
import { Role } from '@prisma/client';

import { DefaultsForm } from '@/components/pricing/DefaultsForm';
import { QuoteCalculator } from '@/components/pricing/QuoteCalculator';
import { ServiceEditor } from '@/components/pricing/ServiceEditor';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { hasRole, requireAuth } from '@/lib/auth/context';
import { mapsEnabled } from '@/lib/maps/client';
import { prisma } from '@/lib/db/client';
import { formatBps, formatCents } from '@/lib/money';
import { PRICING_RULE_SELECT, SERVICE_SELECT } from '@/lib/services/repository';

export const metadata: Metadata = { title: 'Pricing' };
export const dynamic = 'force-dynamic';

/** Human wording for each rule kind, and how to read its amount. */
const RULE_KIND_LABELS: Record<string, string> = {
  PER_UNIT_AREA: 'per 1,000 sq ft',
  PER_MILE: 'per mile',
  FLAT_SURCHARGE: 'flat surcharge',
  PERCENT_SURCHARGE: 'of cost',
  SEASONAL_MULTIPLIER: 'seasonal multiplier',
};

export default async function PricingSettingsPage() {
  const auth = await requireAuth();
  const canEdit = hasRole(auth, Role.ADMIN);
  const currency = auth.organization.currency;

  // Organization is the tenant rather than a row inside one, so its defaults are
  // read through the unscoped client using the id from the verified session.
  const [organization, services, rules] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: auth.organization.id },
      select: {
        defaultLaborRateCents: true,
        defaultProfitMarginBps: true,
        defaultTravelFeeCents: true,
        defaultMinimumJobCents: true,
        defaultOverheadCents: true,
        defaultTaxRateBps: true,
        fuelPricePerGallonCents: true,
        vehicleMpgMilli: true,
      },
    }),
    auth.db.service.findMany({
      select: SERVICE_SELECT,
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    }),
    auth.db.pricingRule.findMany({
      select: PRICING_RULE_SELECT,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Pricing</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your rates, your margin, your floor. Every quote starts here and can be overridden.
        </p>
      </div>

      <Card>
        <CardHeader title="Defaults" description="What a new quote assumes before you touch it" />
        <DefaultsForm defaults={organization} canEdit={canEdit} />
      </Card>

      <Card>
        <CardHeader
          title="Services"
          description={`${services.length} in your catalogue`}
        />
        <ServiceEditor
          services={services.map((service) => ({
            id: service.id,
            name: service.name,
            description: service.description,
            basePriceCents: service.basePriceCents,
            minimumPriceCents: service.minimumPriceCents,
            unitPriceCents: service.unitPriceCents,
            unitSizeSqFt: service.unitSizeSqFt,
            estimatedMinutes: service.estimatedMinutes,
            materialCostCents: service.materialCostCents,
            taxable: service.taxable,
            active: service.active,
          }))}
          currency={currency}
          canEdit={canEdit}
        />
      </Card>

      <Card>
        <CardHeader
          title="Pricing rules"
          description="Surcharges applied on top of a service, before margin"
        />

        {rules.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
            No rules yet. Rules cover the things that make a job harder — a steep slope, a weekend
            callout, a long drive. They are added to cost, so the extra effort still earns your
            margin rather than eating it.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rules.map((rule) => {
              const proportional =
                rule.kind === 'PERCENT_SURCHARGE' || rule.kind === 'SEASONAL_MULTIPLIER';

              return (
                <li key={rule.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {rule.name}
                      </p>
                      {rule.active ? null : <Badge tone="neutral">Off</Badge>}
                      {rule.serviceId === null ? <Badge tone="info">All services</Badge> : null}
                    </div>

                    {rule.minValue !== null || rule.maxValue !== null ? (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Applies between {rule.minValue ?? 0} and {rule.maxValue ?? '∞'}
                      </p>
                    ) : null}
                  </div>

                  <span className="tabular shrink-0 text-sm text-slate-700 dark:text-slate-300">
                    {proportional
                      ? formatBps(rule.amount)
                      : formatCents(rule.amount, currency)}{' '}
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {RULE_KIND_LABELS[rule.kind] ?? ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Quote calculator"
          description="Nothing here is saved — it is for checking a price before you commit to it"
        />
        <div className="p-4">
          <QuoteCalculator
            mapsEnabled={mapsEnabled()}
            services={services
              .filter((service) => service.active)
              .map((service) => ({
                id: service.id,
                name: service.name,
                estimatedMinutes: service.estimatedMinutes,
                unitSizeSqFt: service.unitSizeSqFt,
              }))}
            currency={currency}
            defaults={{
              laborRateCents: organization.defaultLaborRateCents,
              profitMarginBps: organization.defaultProfitMarginBps,
              travelFeeCents: organization.defaultTravelFeeCents,
              minimumJobCents: organization.defaultMinimumJobCents,
              overheadCents: organization.defaultOverheadCents,
              taxRateBps: organization.defaultTaxRateBps,
            }}
          />
        </div>
      </Card>
    </div>
  );
}
