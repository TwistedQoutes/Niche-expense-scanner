'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { PRIMARY_NAV, activeHref } from '@/components/layout/navigation';
import { cn } from '@/lib/cn';

/**
 * Mobile navigation.
 *
 * This is the primary navigation for most of this audience — the owner is in a
 * truck, not at a desk. Five destinations, each a full-height touch target, and
 * padded for the iOS home indicator so the last row is not half-covered.
 */
export function BottomNav() {
  const pathname = usePathname();
  const current = activeHref(pathname);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[var(--spacing-safe-bottom)] backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/95"
    >
      <ul className="mx-auto flex max-w-lg">
        {PRIMARY_NAV.map((item) => {
          const isCurrent = current === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors',
                  isCurrent
                    ? 'text-brand-700 dark:text-brand-400'
                    : 'text-slate-500 dark:text-slate-400',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 w-6 rounded-full transition-colors',
                    isCurrent ? 'bg-brand-600 dark:bg-brand-400' : 'bg-transparent',
                  )}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
