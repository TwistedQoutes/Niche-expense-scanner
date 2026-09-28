import type { Metadata } from 'next';
import { connection } from 'next/server';

import { AuthForm } from '@/components/auth/AuthForm';
import { getPublicConfig } from '@/lib/env';

export const metadata: Metadata = { title: 'Start free' };

export default async function SignupPage() {
  // Read at request time, like the home page: a statically rendered page would
  // freeze TRIAL_DAYS at build and keep promising a trial the deployment had
  // since changed.
  await connection();
  const { trialDays } = getPublicConfig();

  return <AuthForm mode="signup" trialDays={trialDays} />;
}
