import Link from 'next/link';

import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-brand-700 dark:text-brand-400 text-sm font-semibold">404</p>
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        We could not find that page
      </h1>
      <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">
        The link may be out of date, or the quote it pointed at may have expired.
      </p>
      <Link href="/">
        <Button variant="secondary">Back to JobFlow</Button>
      </Link>
    </div>
  );
}
