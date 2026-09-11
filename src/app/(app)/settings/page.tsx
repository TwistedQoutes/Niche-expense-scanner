import type { Metadata } from 'next';

import { BillingPanel } from '@/components/settings/BillingPanel';
import { DangerZone } from '@/components/settings/DangerZone';
import { ReceiptStorageToggle } from '@/components/settings/ReceiptStorageToggle';
import { SecurityPanel } from '@/components/settings/SecurityPanel';
import { requireUser } from '@/lib/auth/current-user';
import { evaluateAccess } from '@/lib/billing/access';
import { emailEnabled } from '@/lib/email';
import { describePrice } from '@/lib/billing/price';
import { MAX_STORED_IMAGE_BYTES, storageEnabled } from '@/lib/storage';

export const metadata: Metadata = { title: 'Settings' };

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  const access = evaluateAccess(user);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as {user.email}
        </p>
      </div>

      <BillingPanel
        access={access}
        priceLabel={describePrice()}
        hasBillingAccount={user.stripeCustomerId !== null}
      />

      <ReceiptStorageToggle
        initialEnabled={user.storeReceiptImages}
        available={storageEnabled()}
        maxImageBytes={MAX_STORED_IMAGE_BYTES}
      />

      <SecurityPanel
        emailVerified={user.emailVerifiedAt !== null}
        email={user.email}
        emailDeliverable={emailEnabled()}
      />

      <DangerZone />
    </div>
  );
}
