'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

const TABS = [
  { href: '/dashboard', label: 'Expenses', icon: 'M3 6h18M3 12h18M3 18h12' },
  { href: '/scan', label: 'Scan', icon: 'M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M7 12h10' },
  {
    href: '/settings',
    label: 'Settings',
    icon: 'M10.3 4.3a1 1 0 0 1 1-.8h1.4a1 1 0 0 1 1 .8l.2 1.2a6.6 6.6 0 0 1 1.5.9l1.1-.5a1 1 0 0 1 1.2.3l.7 1.2a1 1 0 0 1-.2 1.2l-.9.8a6.6 6.6 0 0 1 0 1.7l.9.8a1 1 0 0 1 .2 1.2l-.7 1.2a1 1 0 0 1-1.2.3l-1.1-.5a6.6 6.6 0 0 1-1.5.9l-.2 1.2a1 1 0 0 1-1 .8h-1.4a1 1 0 0 1-1-.8l-.2-1.2a6.6 6.6 0 0 1-1.5-.9l-1.1.5a1 1 0 0 1-1.2-.3l-.7-1.2a1 1 0 0 1 .2-1.2l.9-.8a6.6 6.6 0 0 1 0-1.7l-.9-.8a1 1 0 0 1-.2-1.2l.7-1.2a1 1 0 0 1 1.2-.3l1.1.5a6.6 6.6 0 0 1 1.5-.9ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  },
] as const;

/**
 * Thumb-reachable primary navigation.
 *
 * On a phone the bottom edge is where a one-handed user can actually reach, so
 * the two things this app does live there. It is hidden on wider screens, where
 * the header nav takes over.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="flex">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                  active
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
                )}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  className="size-6"
                  aria-hidden="true"
                >
                  <path d={tab.icon} />
                </svg>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
