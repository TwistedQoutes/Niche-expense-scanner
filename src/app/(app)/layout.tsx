import { redirect } from 'next/navigation';

import { BottomNav } from '@/components/layout/BottomNav';
import { TopBar } from '@/components/layout/TopBar';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * The authenticated shell.
 *
 * This is the real authorisation gate — the middleware only does a cheap cookie
 * presence check. Every page nested under this layout is guaranteed a verified
 * session and an existing user row.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-dvh">
      <TopBar user={user} />
      {/* Bottom padding clears the fixed mobile nav. */}
      <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-24 sm:pb-10">{children}</div>
      <BottomNav />
    </div>
  );
}
