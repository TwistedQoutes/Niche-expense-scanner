import type { Metadata } from 'next';
import Link from 'next/link';

import { AcceptInvite } from '@/components/team/AcceptInvite';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { resolveInvitation, roleLabel } from '@/lib/team/repository';
import { inviteTokenSchema } from '@/lib/validation/team';

export const metadata: Metadata = { title: 'Join a workspace' };
export const dynamic = 'force-dynamic';

/**
 * The invitation link.
 *
 * Unauthenticated, because the person opening it may have no account — that is
 * what being invited means. Everything shown comes out of the row the token
 * identifies: the business name, the address it was sent to, the role. Nothing in
 * the URL besides the token selects anything, so there is no way to point this at
 * another workspace or ask for a role nobody granted.
 *
 * A spent, withdrawn or expired token gets the same page as a made-up one. That is
 * deliberate: distinguishing "already used" from "never existed" tells someone
 * probing the id space which of their guesses landed.
 */
export default async function InvitePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  const parsed = inviteTokenSchema.safeParse(token);
  const invitation = parsed.success ? await resolveInvitation(parsed.data) : null;

  if (!parsed.success || !invitation) {
    return (
      <div className="w-full max-w-sm space-y-4">
        <Alert tone="warning">
          That invitation link is not valid any more. It may have been used already,
          withdrawn, or simply expired — ask whoever invited you to send a new one.
        </Alert>

        <Link href="/login">
          <Button variant="secondary">Go to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <AcceptInvite
        token={parsed.data}
        email={invitation.email}
        organizationName={invitation.organizationName}
        roleLabel={roleLabel(invitation.role)}
        hasAccount={invitation.hasAccount}
      />
    </div>
  );
}
