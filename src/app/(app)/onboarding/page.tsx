import type { Metadata } from 'next';
import Link from 'next/link';

import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { requireAuth } from '@/lib/auth/context';
import { loadOnboardingState } from '@/lib/onboarding/repository';

export const metadata: Metadata = { title: 'Set up your workspace' };
export const dynamic = 'force-dynamic';

/**
 * The setup wizard.
 *
 * Reachable at any time, including after it has been finished — an owner who
 * changes trade or moves states should be able to walk it again rather than hunt
 * for the four fields separately. So there is no redirect away when already
 * onboarded, only a note saying so.
 */
export default async function OnboardingPage() {
  const auth = await requireAuth();
  const state = await loadOnboardingState(auth.db, auth.organization.id);

  return (
    <div className="p-4 lg:p-6">
      {state.onboarded ? (
        <p className="mx-auto mb-4 w-full max-w-xl text-sm text-slate-500 dark:text-slate-400">
          Your workspace is already set up — this just walks the same settings again.{' '}
          <Link href="/settings" className="underline underline-offset-2">
            Settings
          </Link>{' '}
          has the rest.
        </p>
      ) : null}

      <OnboardingWizard initial={state} />
    </div>
  );
}
