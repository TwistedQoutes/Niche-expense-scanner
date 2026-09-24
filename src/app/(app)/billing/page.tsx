import { PlanTier, Role, SubscriptionStatus, UsageMetric } from '@prisma/client';
import type { Metadata } from 'next';

import { PlanActions } from '@/components/billing/PlanActions';
import { UsageBar } from '@/components/billing/UsageBar';
import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAuth } from '@/lib/auth/context';
import { PLANS, planFor } from '@/lib/billing/plans';
import { effectivePlan, readUsage } from '@/lib/billing/usage';
import { formatDateLabel, formatRelative } from '@/lib/dates';
import { prisma } from '@/lib/db/client';
import { formatCents } from '@/lib/money';
import { billingEnabled } from '@/lib/stripe/client';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

const METRIC_LABEL: Record<UsageMetric, string> = {
  [UsageMetric.LEADS]: 'Leads',
  [UsageMetric.QUOTES]: 'Quotes',
  [UsageMetric.SMS_SENT]: 'Text messages',
  [UsageMetric.EMAILS_SENT]: 'Emails',
  [UsageMetric.AI_CALLS]: 'AI actions',
};

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  [SubscriptionStatus.TRIALING]: 'On trial',
  [SubscriptionStatus.ACTIVE]: 'Active',
  [SubscriptionStatus.PAST_DUE]: 'Payment failed',
  [SubscriptionStatus.CANCELED]: 'Cancelled',
  [SubscriptionStatus.UNPAID]: 'Unpaid',
  [SubscriptionStatus.INCOMPLETE]: 'Not finished',
};

const STATUS_TONE: Record<SubscriptionStatus, BadgeTone> = {
  [SubscriptionStatus.TRIALING]: 'info',
  [SubscriptionStatus.ACTIVE]: 'success',
  [SubscriptionStatus.PAST_DUE]: 'urgent',
  [SubscriptionStatus.CANCELED]: 'danger',
  [SubscriptionStatus.UNPAID]: 'urgent',
  [SubscriptionStatus.INCOMPLETE]: 'pending',
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const auth = await requireAuth();
  const { checkout } = await searchParams;

  const [subscription, invoices] = await Promise.all([
    prisma.subscription.findUnique({
      where: { organizationId: auth.organization.id },
      select: {
        plan: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        stripeCustomerId: true,
      },
    }),
    auth.db.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true,
        number: true,
        amountDueCents: true,
        amountPaidCents: true,
        currency: true,
        status: true,
        hostedInvoiceUrl: true,
        paidAt: true,
        createdAt: true,
      },
    }),
  ]);

  /*
   * What the workspace can actually do right now, which is not always the plan it
   * is nominally on: a lapsed trial or a failed payment falls back to FREE limits
   * without anybody losing their data.
   */
  /*
   * One instant for the whole render. `Date.now()` inline trips the React
   * compiler's purity rule — an impure call during render can give two different
   * answers to the same question in one pass — and reading the clock once is what
   * makes the plan and the trial countdown agree anyway.
   */
  const now = new Date();

  const active = effectivePlan(subscription, now);
  const nominal = subscription?.plan ?? PlanTier.FREE;

  const usage = await Promise.all(
    Object.values(UsageMetric).map((metric) => readUsage(auth.db, active, metric)),
  );

  const canManage = auth.role === Role.OWNER;
  const configured = billingEnabled();
  const trialDaysLeft =
    subscription?.trialEndsAt && subscription.status === SubscriptionStatus.TRIALING
      ? Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / 86_400_000)
      : null;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Billing</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          What you are on, what you have used, and what it costs.
        </p>
      </div>

      {checkout === 'done' ? (
        <Alert tone="success" title="Thank you — that is going through">
          <p>
            Stripe confirms subscriptions in the background, so the plan below updates within a few
            seconds. Reload if it still looks wrong.
          </p>
        </Alert>
      ) : null}

      {checkout === 'cancelled' ? (
        <Alert tone="info" title="Checkout cancelled">
          <p>Nothing was charged, and you are still on your current plan.</p>
        </Alert>
      ) : null}

      {subscription?.status === SubscriptionStatus.PAST_DUE ||
      subscription?.status === SubscriptionStatus.UNPAID ? (
        <Alert tone="warning" title="A payment did not go through">
          <p>
            Your workspace has dropped to the Free plan&rsquo;s limits, but nothing has been
            deleted. Update the card in the billing portal and your plan comes straight back.
          </p>
        </Alert>
      ) : null}

      {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd ? (
        <Alert tone="info" title="Your plan ends soon">
          <p>
            Cancellation takes effect on {formatDateLabel(subscription.currentPeriodEnd, auth.organization.timezone)}.
            Until then nothing changes.
          </p>
        </Alert>
      ) : null}

      {!configured ? (
        <Alert tone="info" title="Billing is not configured on this deployment">
          <p>
            Plans and limits work, and usage is metered, but there is nothing to buy until Stripe
            keys are set. Everything below is live except checkout.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Your plan"
          action={
            <Badge tone={STATUS_TONE[subscription?.status ?? SubscriptionStatus.TRIALING]}>
              {STATUS_LABEL[subscription?.status ?? SubscriptionStatus.TRIALING]}
            </Badge>
          }
        />

        <div className="space-y-3 p-4 pt-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {planFor(nominal).name}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {trialDaysLeft !== null
                  ? trialDaysLeft > 0
                    ? `${trialDaysLeft} ${trialDaysLeft === 1 ? 'day' : 'days'} of trial left — no card needed yet.`
                    : 'Your trial has ended, so Free limits apply.'
                  : subscription?.currentPeriodEnd
                    ? `Renews ${formatRelative(subscription.currentPeriodEnd)}`
                    : planFor(nominal).tagline}
              </p>
            </div>

            {active !== nominal ? (
              <p className="text-sm text-amber-700 dark:text-amber-500">
                {planFor(active).name} limits are in force while billing is unresolved.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="This month"
          description="Counters reset on the first of the month. Deleting a lead does not give the allowance back — it is five a month, not five at a time."
        />
        <div className="space-y-3 p-4 pt-0">
          {usage.map((state) => (
            <UsageBar
              key={state.metric}
              label={METRIC_LABEL[state.metric]}
              used={state.used}
              limit={state.limit}
            />
          ))}
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => (
          <Card
            key={plan.tier}
            className={
              plan.tier === nominal
                ? 'ring-2 ring-brand-500 dark:ring-brand-500'
                : undefined
            }
          >
            <div className="space-y-3 p-4">
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {plan.name}
                  </h2>
                  {plan.tier === nominal ? <Badge tone="success">Current</Badge> : null}
                </div>
                <p className="tabular mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {plan.monthlyPriceCents === 0
                    ? 'Free'
                    : `${formatCents(plan.monthlyPriceCents, auth.organization.currency)}/mo`}
                </p>
              </div>

              <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <PlanActions
                tier={plan.tier}
                currentTier={nominal}
                hasBillingAccount={Boolean(subscription?.stripeCustomerId)}
                canManage={canManage}
                billingConfigured={configured}
              />
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Invoices" description="Mirrored from Stripe" />

        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description="They appear here once a paid plan has been charged."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-900 dark:text-slate-100">
                    {invoice.number ?? 'Invoice'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {invoice.paidAt
                      ? `Paid ${formatDateLabel(invoice.paidAt, auth.organization.timezone)}`
                      : `${invoice.status} · ${formatRelative(invoice.createdAt)}`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="tabular text-sm text-slate-700 dark:text-slate-300">
                    {formatCents(invoice.amountDueCents, invoice.currency)}
                  </span>
                  {invoice.hostedInvoiceUrl ? (
                    <a
                      href={invoice.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-brand-700 dark:text-brand-400 text-sm font-medium hover:underline"
                    >
                      View
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
