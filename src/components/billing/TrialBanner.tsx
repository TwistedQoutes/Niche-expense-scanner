import Link from 'next/link';

import { cn } from '@/lib/cn';
import type { AccessState } from '@/lib/billing/access';

/**
 * The one nudge the app shows about money.
 *
 * Silent while the trial has room, so the product is not selling to someone
 * still deciding whether it works. It appears in the last few days, and stays
 * up once writing is blocked — at which point it is not marketing, it is the
 * explanation for why saving an expense is refusing.
 */
const NUDGE_FROM_DAYS_LEFT = 4;

export function TrialBanner({ access }: { access: AccessState }) {
  const blocked = !access.canWrite;
  const endingSoon =
    access.status === 'trialing' &&
    access.trialDaysLeft !== null &&
    access.trialDaysLeft <= NUDGE_FROM_DAYS_LEFT;

  if (!blocked && !endingSoon && access.status !== 'past_due') return null;

  const message = blocked
    ? 'Your trial has ended. Your records are safe — subscribe to log new expenses.'
    : access.status === 'past_due'
      ? 'Your last payment failed. Update your card to avoid interruption.'
      : `${access.trialDaysLeft} ${access.trialDaysLeft === 1 ? 'day' : 'days'} left of your free trial.`;

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset',
        blocked || access.status === 'past_due'
          ? 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900'
          : 'bg-brand-50 text-brand-900 ring-brand-200 dark:bg-brand-950/50 dark:text-brand-200 dark:ring-brand-900',
      )}
    >
      <span>{message}</span>
      <Link href="/settings" className="shrink-0 font-semibold underline underline-offset-2">
        {blocked || access.status === 'past_due' ? 'Fix this' : 'Subscribe'}
      </Link>
    </div>
  );
}
