import { AppError } from '@/lib/api/errors';
import { evaluateAccess, type BillingFields } from '@/lib/billing/access';

/**
 * Refuses a write when the trial is over and nothing is paying for it.
 *
 * Applied to creating expenses and uploading receipt images — the things that
 * add to an account. Reading, editing, exporting and deleting stay open on
 * purpose: metering the value while never trapping someone's tax records is the
 * whole shape of the paywall.
 *
 * `payment_required` would be the literally correct status, but 402 is poorly
 * handled by intermediaries and reads as an error to fetch wrappers; 403 with a
 * clear message routes better and the client keys off the message anyway.
 */
export function requireWriteAccess(user: BillingFields): void {
  const access = evaluateAccess(user);
  if (access.canWrite) return;

  throw new AppError(
    'forbidden',
    access.status === 'canceled'
      ? 'Your subscription has ended. Resubscribe to log new expenses — everything you have already saved stays available to view and export.'
      : 'Your free trial has ended. Subscribe to log new expenses — everything you have already saved stays available to view and export.',
  );
}
