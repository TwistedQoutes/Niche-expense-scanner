'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { apiRequest } from '@/lib/api-client';
import { PASSWORD_MIN_LENGTH } from '@/lib/validation/team';

export type AcceptInviteProps = {
  token: string;
  email: string;
  organizationName: string;
  roleLabel: string;
  /** Decided by the server from the database, never from anything in the URL. */
  hasAccount: boolean;
};

/**
 * Taking up an invitation.
 *
 * Two shapes, and which one you get is settled server-side. Somebody who already
 * has an account is joined and then sent to sign in — attaching a membership to an
 * existing account is fine on the strength of the emailed token, but *using* it has
 * to be done by whoever can actually sign in as them. Somebody new chooses a
 * password here and lands in the workspace, which is strictly more proof than
 * signup asks for: they hold a link sent to their address.
 */
export function AcceptInvite(props: AcceptInviteProps) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [joined, setJoined] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const body = props.hasAccount
        ? { token: props.token }
        : { token: props.token, name, password };

      await apiRequest('/api/team/invites/accept', { method: 'POST', body });

      if (props.hasAccount) {
        setJoined(true);
        setSubmitting(false);
        return;
      }

      router.replace('/dashboard');
      router.refresh();
    } catch (caught) {
      const errors = (caught as { fieldErrors?: Record<string, string> }).fieldErrors;
      if (errors && Object.keys(errors).length > 0) setFieldErrors(errors);
      else setError(caught instanceof Error ? caught.message : 'That did not work.');
      setSubmitting(false);
    }
  }

  if (joined) {
    return (
      <div className="space-y-4">
        <Alert tone="success">
          You have joined {props.organizationName}. Sign in with {props.email} to get started.
        </Alert>
        <Link href={`/login?next=${encodeURIComponent('/dashboard')}`}>
          <Button>Sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Join {props.organizationName}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          You have been invited as {props.roleLabel}, at {props.email}.
        </p>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {props.hasAccount ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          You already have a JobFlow AI account with this address, so there is nothing to set
          up — accept, then sign in as usual.
        </p>
      ) : (
        <>
          <TextField
            label="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={fieldErrors.name}
            autoComplete="name"
            required
          />

          <TextField
            label="Choose a password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            autoComplete="new-password"
            required
          />
        </>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Joining…' : `Join ${props.organizationName}`}
      </Button>
    </form>
  );
}
