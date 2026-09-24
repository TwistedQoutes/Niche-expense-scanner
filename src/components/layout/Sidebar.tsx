'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NAV_SECTIONS, activeHref } from '@/components/layout/navigation';
import { cn } from '@/lib/cn';

/**
 * The desktop sidebar.
 *
 * A client component only because it needs `usePathname` to mark the current
 * page. Everything it renders is static, so this costs one small bundle and no
 * data fetching.
 */
export function Sidebar({
  canSeeAdminItems,
  isPlatformAdmin = false,
}: {
  canSeeAdminItems: boolean;
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const current = activeHref(pathname);

  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 flex-col gap-6 border-r border-slate-200 bg-white px-3 py-4 lg:flex dark:border-slate-800 dark:bg-slate-900"
    >
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter(
          (item) =>
            item.built &&
            (!item.admin || canSeeAdminItems) &&
            (!item.platformAdmin || isPlatformAdmin),
        );
        // A section whose every item is hidden by role should not leave its
        // heading behind as a label over nothing.
        if (items.length === 0) return null;

        return (
          <div key={section.title}>
            <p className="px-3 pb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
              {section.title}
            </p>

            <ul className="space-y-0.5">
              {items.map((item) => {
                const isCurrent = current === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={cn(
                        'flex min-h-9 items-center rounded-lg px-3 text-sm font-medium',
                        'transition-colors duration-150 ease-out',
                        isCurrent
                          ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/60 dark:text-brand-200'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
