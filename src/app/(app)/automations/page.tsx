import type { Metadata } from 'next';
import { AutomationActionType, AutomationRunStatus, Role } from '@prisma/client';

import { AutomationToggle } from '@/components/automations/AutomationToggle';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { hasRole, requireAuth } from '@/lib/auth/context';
import { emailEnabled } from '@/lib/email';
import { getEnv } from '@/lib/env';
import { smsEnabled } from '@/lib/sms';

export const metadata: Metadata = { title: 'Automations' };
export const dynamic = 'force-dynamic';

/** Human wording for a delay, so "4320" reads as "3 days". */
function describeDelay(minutes: number): string {
  if (minutes === 0) return 'immediately';
  if (minutes < 60) return `after ${minutes} min`;
  if (minutes < 60 * 24) {
    const hours = Math.round(minutes / 60);
    return `after ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(minutes / (60 * 24));
  return `after ${days} day${days === 1 ? '' : 's'}`;
}

const ACTION_LABELS: Record<AutomationActionType, string> = {
  SEND_SMS: 'Send a text',
  SEND_EMAIL: 'Send an email',
  NOTIFY_OWNER: 'Notify you',
  CREATE_TASK: 'Create a task',
  REQUEST_REVIEW: 'Ask for a review',
  CHANGE_LEAD_STATUS: 'Move the lead',
};

/** Which channel a step needs, so a disabled one can explain itself. */
function requiredChannel(action: AutomationActionType): 'sms' | 'email' | null {
  if (action === AutomationActionType.SEND_SMS || action === AutomationActionType.REQUEST_REVIEW) {
    return 'sms';
  }
  if (action === AutomationActionType.SEND_EMAIL) return 'email';
  return null;
}

export default async function AutomationsPage() {
  const auth = await requireAuth();
  const canEdit = hasRole(auth, Role.ADMIN);

  const [automations, runningCounts] = await Promise.all([
    auth.db.automation.findMany({
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        trigger: true,
        enabled: true,
        steps: {
          orderBy: { position: 'asc' },
          select: { id: true, position: true, delayMinutes: true, action: true, template: true },
        },
      },
    }),
    auth.db.automationRun.groupBy({
      by: ['automationId'],
      where: { status: AutomationRunStatus.PENDING },
      _count: true,
    }),
  ]);

  const pendingByAutomation = new Map(
    runningCounts.map((row) => [row.automationId, row._count]),
  );

  const sms = smsEnabled();
  const email = emailEnabled();
  const workerOn = Boolean(getEnv().CRON_SECRET);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Automations</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          The follow-ups that happen whether or not you remember them.
        </p>
      </div>

      {!workerOn ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          The scheduler is not running: <code>CRON_SECRET</code> is unset, so nothing will fire even
          if an automation is switched on. Set it and point a cron at{' '}
          <code>/api/cron/automations</code>.
        </p>
      ) : null}

      {automations.map((automation) => {
        // An automation whose only channel is unconfigured would run and send
        // nothing, so the reason is shown rather than letting it look broken.
        const needs = new Set(
          automation.steps.map((step) => requiredChannel(step.action)).filter(Boolean),
        );
        const missing: string[] = [];
        if (needs.has('sms') && !sms) missing.push('Twilio');
        if (needs.has('email') && !email) missing.push('Resend');

        const pending = pendingByAutomation.get(automation.id) ?? 0;

        return (
          <Card key={automation.id}>
            <CardHeader
              title={automation.name}
              description={automation.description ?? undefined}
              action={
                <AutomationToggle
                  automationId={automation.id}
                  enabled={automation.enabled}
                  canEdit={canEdit}
                  blockedReason={
                    missing.length > 0
                      ? `${missing.join(' and ')} not configured — it will run but send nothing.`
                      : null
                  }
                />
              }
            />

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <Badge tone={automation.enabled ? 'success' : 'neutral'}>
                {automation.enabled ? 'On' : 'Off'}
              </Badge>
              <Badge tone="info">when {automation.trigger.replace(/_/g, ' ').toLowerCase()}</Badge>
              {pending > 0 ? <Badge tone="pending">{pending} in flight</Badge> : null}
            </div>

            <ol className="divide-y divide-slate-100 dark:divide-slate-800">
              {automation.steps.map((step) => (
                <li key={step.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="tabular text-xs text-slate-400 dark:text-slate-500">
                      {step.position + 1}
                    </span>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {ACTION_LABELS[step.action]}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {describeDelay(step.delayMinutes)}
                    </span>
                  </div>

                  {step.template ? (
                    <p className="mt-1 text-xs whitespace-pre-wrap text-slate-600 dark:text-slate-400">
                      {step.template}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        );
      })}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Every sequence stops the moment the customer replies, accepts or declines — nothing chases
        someone who has already answered.
      </p>
    </div>
  );
}
