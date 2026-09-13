'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';

export function TopBar({
  organizationName,
  userName,
  userEmail,
}: {
  organizationName: string;
  userName: string | null;
  userEmail: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      // `refresh()` as well as `push()`: the router cache would otherwise hand
      // the next visitor the signed-in shell rendered for the previous one.
      router.replace('/login');
      router.refresh();
    } catch (error) {
      setSigningOut(false);
      toast.error(error instanceof ApiError ? error.message : 'Could not sign out.');
    }
  }

  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <Link href="/dashboard" className="flex items-center gap-2">
        <span className="bg-brand-600 flex size-7 items-center justify-center rounded-lg text-sm font-bold text-white">
          J
        </span>
        <span className="hidden text-sm font-semibold text-slate-900 sm:inline dark:text-slate-100">
          JobFlow AI
        </span>
      </Link>

      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
        /
      </span>

      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-300">
        {organizationName}
      </p>

      <div className="hidden text-right sm:block">
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
          {userName ?? userEmail}
        </p>
        {userName ? (
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{userEmail}</p>
        ) : null}
      </div>

      <Button variant="ghost" size="sm" onClick={signOut} loading={signingOut}>
        Sign out
      </Button>
    </header>
  );
}
