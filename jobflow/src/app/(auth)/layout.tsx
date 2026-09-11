import Link from 'next/link';

/**
 * The signed-out shell.
 *
 * Centred, narrow and free of navigation on purpose: these pages have exactly
 * one job each, and anything else on screen is a way to not finish it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="p-4">
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="bg-brand-600 flex size-7 items-center justify-center rounded-lg text-sm font-bold text-white">
            J
          </span>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            JobFlow AI
          </span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">{children}</main>
    </div>
  );
}
