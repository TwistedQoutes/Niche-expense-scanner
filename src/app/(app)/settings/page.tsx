import type { Metadata } from 'next';

import { ReceiptStorageToggle } from '@/components/settings/ReceiptStorageToggle';
import { requireUser } from '@/lib/auth/current-user';
import { MAX_STORED_IMAGE_BYTES, storageEnabled } from '@/lib/storage';

export const metadata: Metadata = { title: 'Settings' };

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as {user.email}
        </p>
      </div>

      <ReceiptStorageToggle
        initialEnabled={user.storeReceiptImages}
        available={storageEnabled()}
        maxImageBytes={MAX_STORED_IMAGE_BYTES}
      />
    </div>
  );
}
