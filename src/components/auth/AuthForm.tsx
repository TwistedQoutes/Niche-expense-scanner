'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';
import { PASSWORD_MIN_LENGTH } from '@/lib/validation';
import type { UserDto } from '@/types';

type Mode = 'login' | 'signup';

const COPY: Record<Mode, { title: string; subtitle: string; submit: string; switchText: string; switchCta: string; switchHref: string }> = {
  login: {
    title: 'Welcome back',
    subtitle: 'Sign in to your expense log.',
    submit: 'Sign in',
    switchText: 'New here?',
    switchCta: 'Create an account',
    switchHref: '/signup',
  },
  signup: {
    title: 'Create your account',
    subtitle: 'Free while in prototype. No card needed.',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchCta: 'Sign in',
    switchHref: '/login',
  },
};

/**
 * One component for both sign-in and sign-up.
 *
 * The two forms differ only in copy and one optional field, and keeping them
 * together means the error handling, the redirect-after-auth behaviour and the
 * loading states cannot drift apart between the pages an artist sees first.
 */
export function AuthForm({ mode, nextPath }: { mode: Mode; nextPath?: string }) {
  const router = useRouter();
  const copy = COPY[mode];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [studioName, setStudioName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      await apiRequest<{ user: UserDto }>(`/api/auth/${mode}`, {
        method: 'POST',
        body: mode === 'signup' ? { email, password, studioName } : { email, password },
      });

      // `next` comes from the URL, so it is treated as untrusted: only a
      // same-site absolute path is followed, never an external origin.
      const destination = nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//')
        ? nextPath
        : '/dashboard';

      // A full refresh so server components re-read the new session cookie.
      router.replace(destination);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
        // A message already shown inline would be duplicated at the top.
        if (Object.keys(error.fieldErrors).length === 0) setFormError(error.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <Link
          href="/"
          className="text-brand-600 dark:text-brand-400 text-sm font-semibold tracking-wide uppercase"
        >
          Niche Expense Scanner
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{copy.subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <TextField
          label="Email"
          type="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          required
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
          placeholder="you@studio.com"
        />

        <TextField
          label="Password"
          type="password"
          name="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          required
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          hint={mode === 'signup' ? `At least ${PASSWORD_MIN_LENGTH} characters.` : undefined}
        />

        {mode === 'signup' ? (
          <TextField
            label="Studio or artist name"
            name="studioName"
            value={studioName}
            onChange={(event) => setStudioName(event.target.value)}
            error={fieldErrors.studioName}
            autoComplete="organization"
            placeholder="Optional"
          />
        ) : null}

        <Button type="submit" size="lg" fullWidth loading={submitting}>
          {submitting ? 'Just a moment…' : copy.submit}
        </Button>

        {mode === 'login' ? (
          <p className="text-center">
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-400"
            >
              Forgot your password?
            </Link>
          </p>
        ) : null}
      </form>

      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        {copy.switchText}{' '}
        <Link href={copy.switchHref} className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
          {copy.switchCta}
        </Link>
      </p>
    </main>
  );
}
