import type { Metadata } from 'next';
import Link from 'next/link';

import { Logo } from '@/components/marketing/Logo';
import { buttonClasses } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Workspace deleted',
  robots: { index: false },
};

/**
 * Where an owner lands after deleting their workspace.
 *
 * Deliberately says only what is true for everyone who can reach it: anybody
 * can open this URL, so it cannot confirm that a particular workspace was
 * deleted, and it does not try.
 */
export default function GoodbyePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-16">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold text-slate-900 dark:text-slate-50">
        Your workspace has been deleted
      </h1>
      <p className="mt-3 text-pretty text-slate-600 dark:text-slate-400">
        Its customers, leads, quotes, jobs, messages and photos are gone, any subscription was
        cancelled, and you have been signed out. Thank you for trying JobFlow.
      </p>
      <Link href="/" className={buttonClasses({ variant: 'secondary', className: 'mt-8 self-start' })}>
        Back to the home page
      </Link>
    </main>
  );
}
