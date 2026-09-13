import type { Metadata } from 'next';

import { AuthForm } from '@/components/auth/AuthForm';
import { Alert } from '@/components/ui/Alert';
import { safeReturnPath } from '@/lib/auth/return-path';

export const metadata: Metadata = { title: 'Sign in' };

/** Messages we are willing to display, keyed by the reason that produced them. */
const ENDED_MESSAGES = new Set([
  'This workspace is suspended. Please contact support.',
  'Your access to this workspace has ended.',
  'Your session has ended. Please sign in again.',
]);

export default async function LoginPage(props: {
  searchParams: Promise<{ next?: string; ended?: string; reset?: string }>;
}) {
  const { next, ended, reset } = await props.searchParams;

  // Only a same-site path is accepted. Echoing an arbitrary `next` into a
  // redirect is an open redirect: an attacker mails a link to our own login
  // page that bounces to theirs, wearing our domain in the address bar. The
  // decision is a URL parser's, not a prefix test's — see the note in
  // src/lib/auth/return-path.ts for the version of this that was exploitable.
  const nextPath = safeReturnPath(next);

  // Allow-listed rather than rendered as given. Text from a query string shown
  // on a sign-in page is a phishing primitive — it lets anyone put their own
  // wording in our voice, above our password field.
  const endedMessage = ended && ENDED_MESSAGES.has(ended) ? ended : null;

  return (
    <div className="w-full max-w-sm space-y-4">
      {endedMessage ? <Alert tone="warning">{endedMessage}</Alert> : null}

      {reset === '1' ? (
        <Alert tone="success">
          Your password has been changed. Sign in with your new one.
        </Alert>
      ) : null}

      <AuthForm mode="login" nextPath={nextPath} />
    </div>
  );
}
