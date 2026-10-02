import type { Metadata } from 'next';

import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { emailEnabled } from '@/lib/email';

export const metadata: Metadata = { title: 'Reset your password' };

/**
 * Rendered per request, not at build time.
 *
 * `emailEnabled()` reads the deployment's environment, and a prerender happens
 * on a build machine that has none — which made `next build` fail outright
 * without DATABASE_URL and AUTH_SECRET, contradicting the deployment runbook's
 * claim that the build needs no database. Whether this deployment can send mail
 * is a property of the running server anyway, so a cached answer from build
 * time would be the wrong answer the moment the driver was configured.
 */
export const dynamic = 'force-dynamic';

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
