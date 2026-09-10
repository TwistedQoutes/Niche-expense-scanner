import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { getCurrentUser } from '@/lib/auth/current-user';
import { CATEGORY_LIST } from '@/lib/categories/taxonomy';
import { storageEnabled } from '@/lib/storage';

// Depends on the signed-in session and on runtime-only env (RECEIPT_STORAGE_DRIVER
// via storageEnabled), neither of which is available while Next prerenders pages
// at build time. Same reasoning as the dashboard/settings pages.
export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  // Signed-in artists have no use for the pitch.
  if (await getCurrentUser()) redirect('/dashboard');

  // The privacy claim is only as strong as what this deployment actually does.
  const canStoreImages = storageEnabled();

  const showcased = CATEGORY_LIST.filter((category) => category.id !== 'OTHER').slice(0, 9);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-10">
      <div className="flex-1">
        <p className="text-brand-600 dark:text-brand-400 text-sm font-semibold tracking-wide uppercase">
          For tattoo artists
        </p>
        <h1 className="mt-2 text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
          Photograph the receipt. We&rsquo;ll do the bookkeeping.
        </h1>
        <p className="mt-4 text-base text-zinc-600 dark:text-zinc-400">
          Snap a supplier receipt and it&rsquo;s read, categorised and filed — needles, ink, stencil paper,
          gloves, booth rent. Export a clean CSV at tax time.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Link href="/signup" className="block">
            <Button size="lg" fullWidth>
              Create a free account
            </Button>
          </Link>
          <Link href="/login" className="block">
            <Button size="lg" variant="secondary" fullWidth>
              Sign in
            </Button>
          </Link>
        </div>

        <section className="mt-12">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Categories built for the trade
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Not &ldquo;Office supplies&rdquo;. The real shape of a tattoo business.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {showcased.map((category) => (
              <li
                key={category.id}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${category.chipClass}`}
              >
                {category.label}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
          <div className="flex gap-3">
            <span aria-hidden="true">🔒</span>
            <p>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                Reading happens on your phone.
              </span>{' '}
              Text recognition runs in your browser, so the image never has to be uploaded.
              {canStoreImages
                ? ' Keeping a copy for your records is optional, and off until you turn it on.'
                : ' We never upload it.'}
            </p>
          </div>
          <div className="flex gap-3">
            <span aria-hidden="true">📄</span>
            <p>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">Tax-ready export.</span> Every
              category is mapped to its Schedule C line.
            </p>
          </div>
        </section>
      </div>

      <footer className="mt-12 text-xs text-zinc-400 dark:text-zinc-600">
        Category guidance is general information, not tax advice.
      </footer>
    </main>
  );
}
