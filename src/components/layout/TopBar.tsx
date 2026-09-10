'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import type { UserDto } from '@/types';

export function TopBar({ user }: { user: UserDto }) {
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch {
      // Even if the request fails the user asked to leave; the cookie is
      // http-only so the only honest recovery is to let them retry.
      setSigningOut(false);
    }
  }

  const links = [
    { href: '/dashboard', label: 'Expenses' },
    { href: '/scan', label: 'Scan receipt' },
    { href: '/settings', label: 'Settings' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-4 py-3">
        <Link href="/dashboard" className="min-w-0 shrink">
          <span className="text-brand-600 dark:text-brand-400 block text-[11px] font-semibold tracking-wider uppercase">
            Expense Scanner
          </span>
          <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {user.studioName ?? user.email}
          </span>
        </Link>

        <nav aria-label="Sections" className="ml-auto hidden items-center gap-1 sm:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname.startsWith(link.href) ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname.startsWith(link.href)
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          loading={signingOut}
          className="ml-auto sm:ml-0"
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
