import { Role } from '@prisma/client';
import type { Metadata } from 'next';

import { SettingsForm } from '@/components/settings/SettingsForm';
import { Alert } from '@/components/ui/Alert';
import { Card, CardHeader } from '@/components/ui/Card';
import { requireAuth } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { mapsEnabled } from '@/lib/maps/client';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const auth = await requireAuth();

  const organization = await prisma.organization.findUnique({
    where: { id: auth.organization.id },
    select: {
      name: true,
      ownerName: true,
      email: true,
      phone: true,
      website: true,
      reviewUrl: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      timezone: true,
    },
  });

  if (!organization) throw new Error('The signed-in workspace no longer exists.');

  const canEdit = auth.role === Role.OWNER || auth.role === Role.ADMIN;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your business details, and the two fields other features depend on.
        </p>
      </div>

      {!organization.reviewUrl ? (
        <Alert tone="warning" title="Review requests have nowhere to send people">
          <p>
            Add your review link below and the review automation starts working. Until then it skips
            rather than texting customers a dead link.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Business details" />
        <div className="p-4 pt-0">
          <SettingsForm
            canEdit={canEdit}
            mapsEnabled={mapsEnabled()}
            initial={{
              name: organization.name,
              ownerName: organization.ownerName ?? '',
              email: organization.email ?? '',
              phone: organization.phone ?? '',
              website: organization.website ?? '',
              reviewUrl: organization.reviewUrl ?? '',
              addressLine1: organization.addressLine1 ?? '',
              city: organization.city ?? '',
              state: organization.state ?? '',
              postalCode: organization.postalCode ?? '',
              timezone: organization.timezone,
            }}
          />
        </div>
      </Card>
    </div>
  );
}
