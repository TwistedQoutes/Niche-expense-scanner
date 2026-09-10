'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';

export function ForgotPasswordForm() {
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>

      {sent ? (
        <div className="mt-6 space-y-4">
          {/* Confirms nothing about whether the account exists — the API
              deliberately answers identically either way. */}
          <Alert tone="success" title="Check your email">
            If that address has an account, a reset link is on its way. It expires in an hour.
          </Alert>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
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
          <Link href="/login" className="block">
            <Button variant="secondary" size="lg" fullWidth>
              Back to sign in
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
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
              placeholder="you@studio.com"
            />

            <Button type="submit" size="lg" fullWidth loading={submitting}>
              Send the reset link
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/login" className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
