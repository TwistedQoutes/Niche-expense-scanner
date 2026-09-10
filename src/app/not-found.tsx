import Link from 'next/link';

import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 text-center">
      <p className="text-brand-600 dark:text-brand-400 text-sm font-semibold">404</p>
      <h1 className="mt-1 text-xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        That link doesn&rsquo;t go anywhere.
      </p>
      <div className="mt-6">
        <Link href="/dashboard">
          <Button size="lg" fullWidth>
            Back to expenses
          </Button>
        </Link>
      </div>
    </main>
  );
}
