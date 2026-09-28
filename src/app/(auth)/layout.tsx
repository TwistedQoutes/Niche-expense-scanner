import Link from 'next/link';

import { AuthShowcase } from '@/components/auth/AuthShowcase';
import { Logo } from '@/components/marketing/Logo';

/**
 * The signed-out shell: the form on one side, the product on the other.
 *
 * The form column keeps the old rule — one job per page, nothing on screen that
 * is a way to not finish it — so the only links are home (the logo) and the
 * legal pages at the foot. The showcase beside it carries the home page's look
 * and promise, and only appears where there is room for it; on a phone the form
 * starts at the top of the screen.
 *
 * The grid texture and green glow at the top of the form column are the home
 * page hero's, so a visitor who clicked "Start free" lands somewhere that is
 * visibly the same place.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] dark:bg-slate-950">
      {/* overflow-x-clip: the glow below is wider than a phone, and without the
          clip it widens the page and lets it scroll sideways. Clip, not hidden,
          so the column never becomes a scroll container of its own. */}
      <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip">
        <div aria-hidden="true" className="hero-grid absolute inset-x-0 top-0 -z-10 h-96" />
        <div
          aria-hidden="true"
          className="absolute -top-40 left-1/2 -z-10 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-brand-400/15 blur-3xl dark:bg-brand-500/10"
        />

        <header className="px-5 py-5 sm:px-8">
          <Link href="/" aria-label="JobFlow AI home" className="inline-flex rounded-lg">
            <Logo />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center px-5 pt-4 pb-16 sm:px-8">
          <div className="animate-rise w-full max-w-sm">{children}</div>
        </main>

        <footer className="flex items-center justify-between gap-4 px-5 pb-6 text-xs text-slate-500 sm:px-8 dark:text-slate-400">
          <span>© {new Date().getFullYear()} JobFlow AI</span>
          <nav className="flex gap-4">
            <Link href="/legal/privacy" className="hover:text-slate-800 dark:hover:text-slate-200">
              Privacy
            </Link>
            <Link href="/legal/terms" className="hover:text-slate-800 dark:hover:text-slate-200">
              Terms
            </Link>
          </nav>
        </footer>
      </div>

      <AuthShowcase />
    </div>
  );
}
