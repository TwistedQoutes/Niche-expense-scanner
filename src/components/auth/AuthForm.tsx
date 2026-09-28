'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { PasswordField } from '@/components/auth/PasswordField';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';
import { PASSWORD_MIN_LENGTH } from '@/lib/validation/auth';

type Mode = 'login' | 'signup';

const COPY: Record<
  Mode,
  {
    title: string;
    subtitle: string;
    submit: string;
    switchText: string;
    switchCta: string;
    switchHref: string;
  }
> = {
  login: {
    title: 'Welcome back',
    subtitle: 'Sign in to pick up where you left off.',
    submit: 'Sign in',
    switchText: 'New to JobFlow?',
    switchCta: 'Start free',
    switchHref: '/signup',
  },
  signup: {
    title: 'Create your workspace',
    // Replaced below when a trial is on offer. "About two minutes" was never
    // measured; four questions is what the setup wizard actually asks.
    subtitle: 'Free to start. Four questions to set up.',
    submit: 'Create my workspace',
    switchText: 'Already have an account?',
    switchCta: 'Sign in',
    switchHref: '/login',
  },
};

type AuthResponse = {
  user: { id: string; email: string; name: string | null };
  organization: { id: string; slug: string; name: string };
};

/**
 * One component for both sign-in and sign-up.
 *
 * The two differ only in copy and three fields, and keeping them together means
 * the error handling, the redirect-after-auth behaviour and the loading states
 * cannot drift apart between the two pages every customer sees first.
 */
export function AuthForm({
  mode,
  nextPath,
  trialDays = 0,
}: {
  mode: Mode;
  nextPath?: string;
  /** From TRIAL_DAYS, so the promise on this screen is the one provisioning keeps. */
  trialDays?: number;
}) {
  const router = useRouter();
  const copy = COPY[mode];
  const subtitle =
    mode === 'signup' && trialDays > 0
      ? `${trialDays} days of Pro, free. Four questions to set up.`
      : copy.subtitle;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
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
      await apiRequest<AuthResponse>(`/api/auth/${mode}`, {
        method: 'POST',
        body:
          mode === 'signup'
            ? { email, password, businessName, ownerName, phone: phone || undefined }
            : { email, password },
      });

      // A brand-new workspace goes to setup; a returning user goes where they
      // were headed before the proxy bounced them to the login page.
      const destination = mode === 'signup' ? '/onboarding' : (nextPath ?? '/dashboard');

      router.replace(destination);
      // Without this the router cache can serve the signed-out shell it
      // rendered a moment ago, and the user lands on a page that still thinks
      // they are anonymous.
      router.refresh();
    } catch (error) {
      setSubmitting(false);

      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
        // A field-level message is already shown next to its input; repeating
        // it in a banner is noise.
        if (Object.keys(error.fieldErrors).length === 0) setFormError(error.message);
        return;
      }

      setFormError('Something went wrong. Please try again.');
    }
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-balance text-slate-900 dark:text-slate-50">
          {copy.title}
        </h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">{subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        {mode === 'signup' ? (
          <>
            <TextField
              label="Business name"
              name="businessName"
              autoComplete="organization"
              required
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              error={fieldErrors.businessName}
              placeholder="Green Thumb Lawn Care"
            />

            <TextField
              label="Your name"
              name="ownerName"
              autoComplete="name"
              required
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              error={fieldErrors.ownerName}
            />
          </>
        ) : null}

        <TextField
          label="Email"
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />

        {mode === 'signup' ? (
          <TextField
            label="Business phone"
            type="tel"
            name="phone"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={fieldErrors.phone}
            // What the number really does: it is the business's phone, and
            // missed calls and texts to it are matched to this workspace
            // (organizationForTwilioNumber). It sends the owner nothing.
            hint="Optional. The number customers call — missed calls to it become leads once it is connected. You can change it later."
          />
        ) : null}

        <PasswordField
          label="Password"
          name="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          hint={mode === 'signup' ? `At least ${PASSWORD_MIN_LENGTH} characters.` : undefined}
        />

        <Button type="submit" size="lg" fullWidth loading={submitting}>
          {copy.submit}
        </Button>

        {mode === 'signup' ? (
          // The home page's assurances, word for word, so the promise that got
          // them here is the one they see when they commit.
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-500 dark:text-slate-400">
            {[trialDays > 0 ? `${trialDays}-day Pro trial` : null, 'No card required', 'Cancel anytime']
              .filter((item): item is string => item !== null)
              .map((item) => (
                <li key={item} className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-brand-600 dark:text-brand-400" strokeWidth={2.5} aria-hidden="true" />
                  {item}
                </li>
              ))}
          </ul>
        ) : null}
      </form>

      {mode === 'login' ? (
        <p className="mt-4 text-sm">
          <Link
            href="/forgot-password"
            className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Forgot your password?
          </Link>
        </p>
      ) : null}

      <p className="mt-8 border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
        {copy.switchText}{' '}
        <Link
          href={copy.switchHref}
          className="font-medium text-brand-700 hover:underline dark:text-brand-400"
        >
          {copy.switchCta}
        </Link>
      </p>
    </div>
  );
}
