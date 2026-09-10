import type { Metadata } from 'next';

import { ReceiptScanner } from '@/components/scan/ReceiptScanner';
import { requireUser } from '@/lib/auth/current-user';
import { storageEnabled } from '@/lib/storage';

export const metadata: Metadata = { title: 'Scan a receipt' };

export default async function ScanPage() {
  const user = await requireUser();

  // Both conditions have to hold: the deployment must be able to store images,
  // and this artist must have asked it to.
  const storeImages = storageEnabled() && user.storeReceiptImages;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Scan a receipt</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          We&rsquo;ll pull out the total, date and merchant, then file it under the right category.
        </p>
      </div>

      <ReceiptScanner storeImages={storeImages} />
    </div>
  );
}
