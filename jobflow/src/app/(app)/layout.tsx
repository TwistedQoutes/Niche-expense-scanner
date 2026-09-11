import { redirect } from 'next/navigation';

import { BottomNav } from '@/components/layout/BottomNav';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { hasRole, redirectForFailure, resolveAuth } from '@/lib/auth/context';

/**
 * The signed-in shell.
 *
 * This is where authorisation actually happens for every application page.
 * `src/proxy.ts` only checks that a cookie exists — it runs at the edge and
 * cannot read the database — so the real decision is made here, once, in a
 * server component that every page under (app) renders inside.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const outcome = await resolveAuth();

  if (!outcome.ok) {
    // Not always /login. A cookie that is valid but no longer usable has to be
    // cleared first, or the proxy sends them right back here — see
    // redirectForFailure and src/app/api/auth/session-ended.
    redirect(redirectForFailure(outcome.reason));
  }

  const auth = outcome.context;

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        organizationName={auth.organization.name}
        userName={auth.user.name}
        userEmail={auth.user.email}
      />

      <div className="flex flex-1">
        <Sidebar canSeeAdminItems={hasRole(auth, 'ADMIN')} />

        {/* The bottom padding clears the mobile nav bar, which is fixed. */}
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
      </div>

      <BottomNav />
    </div>
  );
}
