import type { Metadata } from 'next';

import { TrialBanner } from '@/components/billing/TrialBanner';
import { DashboardClient } from '@/components/dashboard/DashboardClient';
import { evaluateAccess } from '@/lib/billing/access';
import { requireUser } from '@/lib/auth/current-user';
import { currentMonthKey, isMonthKey } from '@/lib/dates';
import { listExpenses, monthsWithExpenses, summariseMonth } from '@/lib/expenses/queries';

export const metadata: Metadata = { title: 'Expenses' };

// Expense data is per-user and changes on every scan; never cache the page.
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();
  const { month: requested } = await searchParams;

  // A hand-edited `?month=` must not reach the query layer unvalidated.
  const month = requested && isMonthKey(requested) ? requested : currentMonthKey();

  const [{ expenses, nextCursor }, summary, availableMonths] = await Promise.all([
    listExpenses(user.id, { month }, { limit: 50 }),
    summariseMonth(user.id, month),
    monthsWithExpenses(user.id),
  ]);

  return (
    <div className="space-y-4">
      <TrialBanner access={evaluateAccess(user)} />
      <DashboardClient
        initialData={{ expenses, summary, nextCursor }}
        initialMonth={month}
        availableMonths={availableMonths}
      />
    </div>
  );
}
