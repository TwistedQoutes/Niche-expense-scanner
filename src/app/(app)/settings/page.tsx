import { Role } from '@prisma/client';
import type { Metadata } from 'next';

import { ResendVerification } from '@/components/auth/ResendVerification';
import { DataControls } from '@/components/settings/DataControls';
import { DeleteAccount } from '@/components/settings/DeleteAccount';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { Alert } from '@/components/ui/Alert';
import { Card, CardHeader } from '@/components/ui/Card';
import { requireAuth } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { emailEnabled } from '@/lib/email';
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

      {/* Everyone's own sign-in, whatever their role. */}
      <Card>
        <CardHeader title="Your sign-in" />
        <div className="space-y-3 p-4 pt-0">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {auth.user.email}{' '}
            {auth.user.emailVerifiedAt ? (
              <span className="font-medium text-brand-700 dark:text-brand-400">· Confirmed</span>
            ) : (
              <span className="font-medium text-amber-700 dark:text-amber-400">· Not confirmed yet</span>
            )}
          </p>
          {!auth.user.emailVerifiedAt ? (
            emailEnabled() ? (
              <ResendVerification email={auth.user.email} />
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                This site cannot send email yet, so there is no link to send.
              </p>
            )
          ) : null}
          <p className="text-sm text-slate-500 dark:text-slate-400">
            To change your password, sign out and use “Forgot your password?”. If you are on someone’s
            team, the owner or an admin may also be able to send you a reset link from the Team page.
          </p>
        </div>
      </Card>

      {/* The whole customer list out, or everything gone: the owner's call alone. */}
      {auth.role === Role.OWNER ? (
        <Card>
          <CardHeader title="Your data" description="It belongs to your business. Take a copy, or take it all away." />
          <div className="p-4 pt-0">
            <DataControls businessName={organization.name} isDemo={auth.organization.isDemo} />
          </div>
        </Card>
      ) : null}

      {/*
        Everyone, not just owners. A crew member leaving a business must be able
        to delete their own sign-in from in here — App Store Guideline 5.1.1(v)
        treats "email us and ask" as not having the feature.
      */}
      <Card>
        <CardHeader title="Your account" description="The sign-in that is yours, rather than the business's." />
        <div className="p-4 pt-0">
          <DeleteAccount email={auth.user.email} />
        </div>
      </Card>
    </div>
  );
}
