import type { Metadata } from 'next';
import Link from 'next/link';

import { NewLeadForm } from '@/components/leads/NewLeadForm';
import { requireAuth } from '@/lib/auth/context';
import { mapsEnabled } from '@/lib/maps/client';

export const metadata: Metadata = { title: 'New lead' };
export const dynamic = 'force-dynamic';

export default async function NewLeadPage() {
  // Not decorative: this page writes, so it authorises even though the layout
  // above it already did. A page that renders a form for someone who cannot
  // submit it is a worse experience than a redirect.
  await requireAuth();

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 lg:p-6">
      <div>
        <Link
          href="/leads"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Back to the pipeline
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">New lead</h1>
      </div>

      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 lg:p-6 dark:bg-slate-900 dark:ring-slate-800">
        <NewLeadForm mapsEnabled={mapsEnabled()} />
      </div>
    </div>
  );
}
