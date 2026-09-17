import type { Metadata } from 'next';

import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { emailEnabled } from '@/lib/email';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  /*
   * Whether this deployment can actually deliver the email.
   *
   * The API answers identically either way — it must, or it becomes a way to
   * ask which addresses have accounts — but the screen should not tell somebody
   * to check an inbox nothing was sent to.
   */
  return <ForgotPasswordForm emailEnabled={emailEnabled()} />;
}
