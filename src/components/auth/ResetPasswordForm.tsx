'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';
import { PASSWORD_MIN_LENGTH } from '@/lib/validation';

export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // Checked here rather than server-side: the confirmation field exists to
    // catch a typo, and only the browser knows what was typed twice.
    if (password !== confirm) {
      setFieldErrors({ confirm: 'Those two passwords do not match.' });
      return;
    }

    setSubmitting(true);
    setFieldErrors({});
    setError(null);

    try {
      await apiRequest('/api/auth/reset-password', { method: 'POST', body: { token, password } });
      router.replace('/dashboard');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fieldErrors);
        if (Object.keys(caught.fieldErrors).length === 0) setError(caught.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
        <Alert tone="error" title="That link is incomplete">
          Open the link from your email again, or request a fresh one.
        </Alert>
        <Link href="/forgot-password" className="mt-6 block">
          <Button size="lg" fullWidth>
            Request a new link
          </Button>
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        This also signs you out everywhere else.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        {error ? (
          <Alert tone="error">
            {error}{' '}
            <Link href="/forgot-password" className="font-medium underline">
              Request a new link
            </Link>
          </Alert>
        ) : null}

        <TextField
          label="New password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          required
          autoComplete="new-password"
        />

        <TextField
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={fieldErrors.confirm}
          required
          autoComplete="new-password"
        />

        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Set the new password
        </Button>
      </form>
    </main>
  );
}
