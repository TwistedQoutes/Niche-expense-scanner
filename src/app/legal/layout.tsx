import Link from 'next/link';

/** Shared frame for the legal pages, readable signed in or out. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-4">
          <Link
            href="/"
            className="text-brand-600 dark:text-brand-400 text-sm font-semibold tracking-wide uppercase"
          >
            Niche Expense Scanner
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/legal/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/legal/privacy" className="hover:underline">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-5 py-10">
        {/* Long-form prose gets tighter measure and looser leading than the app. */}
        <div className="space-y-6 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          {children}
        </div>
      </main>
    </div>
  );
}
