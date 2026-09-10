import type { Metadata } from 'next';

import { VerifyEmail } from '@/components/auth/VerifyEmail';

export const metadata: Metadata = { title: 'Confirm your email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <VerifyEmail token={token} />;
}
