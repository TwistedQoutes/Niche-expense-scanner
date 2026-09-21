'use client';

import { MembershipStatus, Role } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { parseAmountToCents } from '@/lib/money';
import type { PendingInvite, SeatUsage, TeamMember } from '@/lib/team/repository';

const ROLE_LABEL: Record<Role, string> = {
  [Role.OWNER]: 'Owner',
  [Role.ADMIN]: 'Admin',
  [Role.STAFF]: 'Crew',
};

const ROLE_TONE: Record<Role, BadgeTone> = {
  [Role.OWNER]: 'success',
  [Role.ADMIN]: 'info',
  [Role.STAFF]: 'neutral',
};

/**
 * What each role can actually do, in the words of the job rather than the schema.
 *
 * Shown next to the selector because "Admin" and "Crew" mean nothing on their own,
 * and the cost of guessing wrong is giving someone the pricing and the billing.
 */
const ROLE_HELP: Record<'ADMIN' | 'STAFF', string> = {
  ADMIN: 'Everything except billing and removing owners — including pricing.',
  STAFF: 'Leads, quotes, jobs and the calendar. Not pricing, billing or the team.',
};

export type TeamManagerProps = {
  members: TeamMember[];
  invites: PendingInvite[];
  seats: SeatUsage;
  /** Whether the viewer may invite at all. Staff see the list and no buttons. */
  canInvite: boolean;
  /**
   * Whether this deployment can actually send the invitation email. When it
   * cannot, inviting still works and the link is handed back to be passed on by
   * hand — so this only changes what the screen says, never what it allows.
   */
  emailConfigured: boolean;
  isDemo: boolean;
};

/**
 * What this person is paid, inline on their row.
 *
 * Rendered at all only when the viewer may see it — owners and admins see the
 * payroll, everybody else sees their own line and nothing where the others'
 * would be. The server already withholds the number (see listTeam); this is the
 * second half of the same rule, not the enforcement of it.
 *
 * Saved on blur rather than behind a Save button: it is one number on a row of
 * many, and a button per row is a screen of buttons.
 */
function PayRate({ member }: { member: TeamMember }) {
  const router = useRouter();
  const toast = useToast();

  const asText = member.hourlyRateCents === null ? '' : (member.hourlyRateCents / 100).toFixed(2);

  const [value, setValue] = useState(asText);
  const [saving, setSaving] = useState(false);

  if (!member.payVisible) return null;

  if (!member.payEditable) {
    return (
      <span className="tabular text-sm text-slate-500 dark:text-slate-400">
        {member.hourlyRateCents === null ? 'No rate set' : `${asText}/hr`}
      </span>
    );
  }

  async function save() {
    const trimmed = value.trim();
    if (trimmed === asText.trim()) return;

    // Blank clears the rate. That is different from zero, and the difference is
    // the point: cleared takes their hours out of job costs, zero says they cost
    // nothing.
    const cents = trimmed === '' ? null : parseAmountToCents(trimmed);

    if (trimmed !== '' && cents === null) {
      toast.error('Enter an hourly rate like 22 or 22.50.');
      setValue(asText);
      return;
    }

    setSaving(true);

    try {
      await apiRequest(`/api/team/members/${member.userId}`, {
        method: 'PATCH',
        body: { hourlyRateCents: cents },
      });

      toast.success(cents === null ? 'Pay rate cleared.' : 'Pay rate saved.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save that rate.');
      setValue(asText);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center gap-1">
      <span className="sr-only">Hourly pay for {member.name ?? member.email}</span>
      <span className="text-sm text-slate-400 dark:text-slate-500">$</span>
      <input
        type="text"
        inputMode="decimal"
        placeholder="—"
        aria-label={`Hourly pay for ${member.name ?? member.email}`}
        disabled={saving}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="tabular w-16 rounded-lg bg-slate-50 px-2 py-1 text-right text-sm text-slate-800 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
      />
      <span className="text-xs text-slate-400 dark:text-slate-500">/hr</span>
    </label>
  );
}

export function TeamManager(props: TeamManagerProps) {
  const router = useRouter();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'STAFF'>('STAFF');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const [manualLink, setManualLink] = useState<string | null>(null);

  const seatsFull = props.seats.full;
  // Only a demo actually blocks the form. Missing email changes the wording.
  const blocked = props.isDemo;

  async function act<T>(key: string, run: () => Promise<T>, success: string) {
    setBusy(key);
    try {
      await run();
      toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setBusy('invite');

    try {
      const result = await apiRequest<{ delivered: boolean; inviteUrl?: string }>(
        '/api/team/invites',
        { method: 'POST', body: { email, role } },
      );

      setManualLink(result.inviteUrl ?? null);
      toast.success(
        result.delivered
          ? `Invitation sent to ${email}.`
          : `Invitation created for ${email}. Copy the link below and send it to them.`,
      );
      setEmail('');
      router.refresh();
    } catch (error) {
      // Field errors land under the input; everything else is a toast, so a seat
      // limit or a demo refusal is not mistaken for a typo in the address.
      const errors = (error as { fieldErrors?: Record<string, string> }).fieldErrors;
      if (errors && Object.keys(errors).length > 0) setFieldErrors(errors);
      else toast.error(error instanceof Error ? error.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {props.canInvite ? (
        <Card>
          <CardHeader
            title="Invite a teammate"
            description={
              props.seats.limit === null
                ? `${props.seats.used} in the workspace. Your plan has no seat limit.`
                : `${props.seats.used} of ${props.seats.limit} seats used, counting invitations that have not been accepted yet.`
            }
          />

          {props.isDemo ? (
            <Alert tone="warning">
              A demo workspace cannot invite anyone. Sign up for a free account and the
              invitation will work from there.
            </Alert>
          ) : null}

          {!props.emailConfigured && !props.isDemo ? (
            <Alert tone="info">
              This deployment cannot send email yet, so inviting will give you a link to
              pass on yourself. Set <code>EMAIL_DRIVER</code> and <code>RESEND_API_KEY</code>{' '}
              to have it emailed instead.
            </Alert>
          ) : null}

          {manualLink ? (
            <Alert tone="success">
              <p className="font-medium">Send this link to them:</p>
              <p className="mt-1 break-all font-mono text-xs">{manualLink}</p>
              <p className="mt-1">It works once, and expires in seven days.</p>
            </Alert>
          ) : null}

          {seatsFull && !blocked ? (
            <Alert tone="warning">
              Every seat on your plan is in use. Upgrade to add someone, or withdraw an
              invitation below.
            </Alert>
          ) : null}

          <form onSubmit={invite} className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <TextField
                label="Their email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={fieldErrors.email}
                required
                disabled={blocked || seatsFull}
              />

              <SelectField
                label="Role"
                value={role}
                onChange={(event) => setRole(event.target.value as 'ADMIN' | 'STAFF')}
                disabled={blocked || seatsFull}
              >
                <option value="STAFF">Crew</option>
                <option value="ADMIN">Admin</option>
              </SelectField>
            </div>

            <p className="text-sm text-slate-500 dark:text-slate-400">{ROLE_HELP[role]}</p>

            <Button type="submit" disabled={busy !== null || blocked || seatsFull}>
              {busy === 'invite' ? 'Sending…' : 'Send invitation'}
            </Button>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="In this workspace" description={`${props.members.length} people.`} />

        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {props.members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                  {member.name ?? member.email}
                  {member.isSelf ? (
                    <span className="text-slate-500 dark:text-slate-400"> — you</span>
                  ) : null}
                </p>
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">{member.email}</p>
              </div>

              <PayRate member={member} />

              <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABEL[member.role]}</Badge>

              {member.status === MembershipStatus.SUSPENDED ? (
                <Badge tone="danger">Suspended</Badge>
              ) : null}

              {member.manageable ? (
                <div className="flex gap-2">
                  {member.status === MembershipStatus.SUSPENDED ? (
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          member.userId,
                          () =>
                            apiRequest(`/api/team/members/${member.userId}`, {
                              method: 'PATCH',
                              body: { status: 'ACTIVE' },
                            }),
                          'Access restored.',
                        )
                      }
                    >
                      Restore
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() =>
                          act(
                            member.userId,
                            () =>
                              apiRequest(`/api/team/members/${member.userId}`, {
                                method: 'PATCH',
                                body: { role: member.role === Role.ADMIN ? Role.STAFF : Role.ADMIN },
                              }),
                            'Role changed.',
                          )
                        }
                      >
                        Make {member.role === Role.ADMIN ? 'crew' : 'admin'}
                      </Button>

                      <Button
                        variant="danger"
                        disabled={busy !== null}
                        onClick={() =>
                          act(
                            member.userId,
                            () =>
                              apiRequest(`/api/team/members/${member.userId}`, {
                                method: 'DELETE',
                              }),
                            'Access suspended.',
                          )
                        }
                      >
                        Suspend
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {props.invites.length > 0 ? (
        <Card>
          <CardHeader
            title="Invited, not yet joined"
            description="Each of these holds a seat until it is accepted or withdrawn."
          />

          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {props.invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                    {invite.email}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {ROLE_LABEL[invite.role]}
                    {invite.invitedByName ? ` · invited by ${invite.invitedByName}` : null}
                  </p>
                </div>

                {invite.expired ? (
                  <Badge tone="danger">Expired</Badge>
                ) : (
                  <Badge tone="pending">Waiting</Badge>
                )}

                {props.canInvite ? (
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      act(
                        invite.id,
                        () => apiRequest(`/api/team/invites/${invite.id}`, { method: 'DELETE' }),
                        'Invitation withdrawn.',
                      )
                    }
                  >
                    Withdraw
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
