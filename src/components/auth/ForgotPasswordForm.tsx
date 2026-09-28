'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button, buttonClasses } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';

/**
 * "We'll email you a link" is a promise, and a deployment with no email provider
 * cannot keep it.
 *
 * Unconfigured, this screen used to accept the address, say "check your email",
 * and suggest looking in spam for a message that was never sent — which turns a
 * forgotten password into an account nobody can get back into, with the product
 * insisting it did its part. So when there is no way to deliver, the screen says
 * so instead of taking the request.
 *
 * The API is unchanged: it still answers the same way whether or not the address
 * has an account, because that is what stops it being used to find out.
 */
export function ForgotPasswordForm({ emailEnabled = true }: { emailEnabled?: boolean }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await apiRequest('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!emailEnabled) {
    return (
      <div className="w-full">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-slate-900 dark:text-slate-50">Reset your password</h1>

        <div className="mt-6 space-y-4">
          <Alert tone="warning" title="This site cannot send email yet">
            <p>
              Password reset works by emailing you a link, and no email provider is
              configured here — so asking for one would send you to an inbox that
              never receives it.
            </p>
            <p className="mt-2">
              If you run this deployment, setting <code>EMAIL_DRIVER</code> and{' '}
              <code>RESEND_API_KEY</code> turns this screen on. If you are on someone&rsquo;s team,
              the owner or an admin may be able to give you a reset link from their Team page.
            </p>
          </Alert>

          <Link href="/login" className={buttonClasses({ variant: 'secondary', size: 'lg', fullWidth: true })}>
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h1 className="text-3xl font-semibold tracking-[-0.03em] text-slate-900 dark:text-slate-50">Reset your password</h1>

      {sent ? (
        <div className="mt-6 space-y-4">
          {/* Confirms nothing about whether the account exists — the API
              deliberately answers identically either way. */}
          <Alert tone="success" title="Check your email">
            If that address has an account, a reset link is on its way. It expires in an hour.
          </Alert>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Nothing arrived? Check spam, then{' '}
            <button
              type="button"
              onClick={() => setSent(false)}
              className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
            >
              try again
            </button>
            .
          </p>
          <Link href="/login" className={buttonClasses({ variant: 'secondary', size: 'lg', fullWidth: true })}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            We&rsquo;ll email you a link to choose a new one.
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            {error ? <Alert tone="error">{error}</Alert> : null}

            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              autoCapitalize="none"
              inputMode="email"
              spellCheck={false}
              placeholder="you@yourbusiness.com"
            />

            <Button type="submit" size="lg" fullWidth loading={submitting}>
              Send the reset link
            </Button>
          </form>

          <p className="mt-8 border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
            <Link href="/login" className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
