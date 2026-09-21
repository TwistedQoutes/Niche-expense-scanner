import { MembershipStatus, Prisma, Role, type PlanTier } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { conflict, forbidden, notFound } from '@/lib/api/errors';
import { hashToken } from '@/lib/auth/tokens';
import { outranks } from '@/lib/auth/context';
import { seatLimitFor } from '@/lib/billing/plans';
import { prisma } from '@/lib/db/client';
import type { TenantClient } from '@/lib/db/tenant';

/**
 * Who is in a business, and how someone else gets in.
 *
 * Three rules run through everything here, and they are the reason this is a
 * module rather than a handful of route bodies:
 *
 *  1. **You can only act on someone you outrank.** Inviting a role is the same
 *     question as removing a person holding it — minting an ADMIN when you are an
 *     ADMIN is privilege escalation with extra steps — so both go through
 *     `outranks()` in src/lib/auth/context.ts.
 *  2. **A seat is a seat whether or not it has been taken.** An unaccepted
 *     invitation counts against the plan, or the limit is a suggestion: send five
 *     invitations on a two-seat plan and the third person through the door is the
 *     one who finds out.
 *  3. **Accepting happens without a session**, so it cannot use a tenant client.
 *     The organization is derived *from the token*, never from anything the caller
 *     says — the same shape as the public quote page.
 */

/** Seven days. Long enough to survive a weekend, short enough to expire. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TeamMember = {
  userId: string;
  name: string | null;
  email: string;
  role: Role;
  status: MembershipStatus;
  joinedAt: Date | null;
  /** True for the person looking at the screen, who gets no buttons. */
  isSelf: boolean;
  /** Whether the viewer may change or remove this person. */
  manageable: boolean;
  /**
   * What the business pays this person an hour, or null.
   *
   * Null carries two meanings and the screen must not confuse them: nobody has
   * set a rate, or the viewer is not allowed to know. `payVisible` separates
   * them — a crew member sees their own pay and nobody else's, which is the
   * whole rule this field exists to enforce.
   */
  hourlyRateCents: number | null;
  payVisible: boolean;
  /** Whether the viewer may set this person's rate. */
  payEditable: boolean;
};

/**
 * Who may see and set pay.
 *
 * Seeing: owners and admins see the whole payroll, because they are the people
 * who run it; everybody else sees their own rate and nothing else. A crew member
 * being able to look up what the rest of the crew earns is the kind of thing
 * that ends up in an employment tribunal, and no part of this product needs it.
 *
 * Setting: the rank rule that governs roles, plus one deliberate exception —
 * you may always set your own. An owner-operator costing their own hours is the
 * common case, and `requireManageable` refuses self-action because *promoting
 * yourself* is the danger there. Paying yourself is not privilege escalation.
 */
function canSeePay(viewer: { userId: string; role: Role }, targetUserId: string): boolean {
  return (
    viewer.role === Role.OWNER || viewer.role === Role.ADMIN || viewer.userId === targetUserId
  );
}

function canSetPay(
  viewer: { userId: string; role: Role },
  target: { userId: string; role: Role },
): boolean {
  if (viewer.role !== Role.OWNER && viewer.role !== Role.ADMIN) return false;
  return viewer.userId === target.userId || outranks(viewer.role, target.role);
}

export type PendingInvite = {
  id: string;
  email: string;
  role: Role;
  invitedAt: Date;
  expiresAt: Date;
  expired: boolean;
  invitedByName: string | null;
};

export type SeatUsage = {
  used: number;
  /** `null` is unlimited. */
  limit: number | null;
  full: boolean;
};

/** Invitations that could still be accepted: not taken, not withdrawn, not stale. */
function pendingWhere(now: Date): Prisma.InvitationWhereInput {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
}

/**
 * Everyone who currently occupies a seat.
 *
 * Suspended members are deliberately excluded: they cannot sign in, so charging
 * the business for them would be charging for nothing. Pending invitations are
 * deliberately included — see rule 2 above.
 */
export async function seatUsage(
  db: TenantClient,
  plan: PlanTier,
  now: Date = new Date(),
): Promise<SeatUsage> {
  const [members, invites] = await Promise.all([
    db.membership.count({ where: { status: MembershipStatus.ACTIVE } }),
    db.invitation.count({ where: pendingWhere(now) }),
  ]);

  const limit = seatLimitFor(plan);
  const used = members + invites;

  return { used, limit, full: limit !== null && used >= limit };
}

export async function listTeam(
  db: TenantClient,
  viewer: { userId: string; role: Role },
  now: Date = new Date(),
): Promise<{ members: TeamMember[]; invites: PendingInvite[] }> {
  const [memberships, invitations] = await Promise.all([
    db.membership.findMany({
      where: { status: { not: MembershipStatus.INVITED } },
      select: {
        userId: true,
        role: true,
        status: true,
        acceptedAt: true,
        createdAt: true,
        hourlyRateCents: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.invitation.findMany({
      where: { acceptedAt: null, revokedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        invitedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    members: memberships.map((membership) => ({
      userId: membership.userId,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.acceptedAt ?? membership.createdAt,
      isSelf: membership.userId === viewer.userId,
      manageable:
        membership.userId !== viewer.userId && outranks(viewer.role, membership.role),
      // Withheld here rather than hidden in the markup: a value that never
      // leaves the server cannot be read out of a network tab.
      hourlyRateCents: canSeePay(viewer, membership.userId) ? membership.hourlyRateCents : null,
      payVisible: canSeePay(viewer, membership.userId),
      payEditable: canSetPay(viewer, { userId: membership.userId, role: membership.role }),
    })),
    invites: invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      invitedAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      expired: invitation.expiresAt.getTime() <= now.getTime(),
      invitedByName: invitation.invitedBy?.name ?? null,
    })),
  };
}

export type InviteResult = {
  invitation: { id: string; email: string; role: Role; expiresAt: Date };
  /** The plaintext token. It exists here and in one email, and nowhere else. */
  token: string;
};

/**
 * Invites someone, or refuses for a reason the caller can act on.
 *
 * Every refusal names what is wrong rather than saying no: a full plan says which
 * plan and how many seats, an existing member says they are already here, and a
 * role you do not outrank says so. None of those leak anything — the caller is
 * already inside this business and can see the member list on the same screen.
 */
export async function inviteTeammate(
  db: TenantClient,
  context: {
    organizationId: string;
    plan: PlanTier;
    actor: { userId: string; role: Role };
  },
  input: { email: string; role: Role },
  now: Date = new Date(),
): Promise<InviteResult> {
  if (!outranks(context.actor.role, input.role)) {
    throw forbidden(
      `You cannot invite someone as ${roleLabel(input.role)} — that is your own level or above.`,
    );
  }

  const email = input.email.toLowerCase();

  /*
   * Already here? Checked against the membership rather than the invitation, so
   * that re-inviting somebody who has already joined is a clear answer instead of
   * a second email they will ignore.
   */
  const existing = await db.membership.findFirst({
    where: { user: { email } },
    select: { status: true },
  });

  if (existing) {
    throw conflict(
      existing.status === MembershipStatus.SUSPENDED
        ? 'That person is already in this workspace, with access suspended. Restore them instead of inviting them again.'
        : 'That person is already in this workspace.',
      { email: 'Already a member.' },
    );
  }

  const seats = await seatUsage(db, context.plan, now);
  if (seats.full) {
    throw conflict(
      `Your plan includes ${seats.limit} ${seats.limit === 1 ? 'seat' : 'seats'} and ${seats.used} ${seats.used === 1 ? 'is' : 'are'} in use. Upgrade to add someone, or withdraw a pending invitation.`,
      { email: 'No seats left on this plan.' },
    );
  }

  const token = randomBytes(32).toString('base64url');

  /*
   * Supersede before issuing, in one transaction, exactly as `issueToken` does:
   * sending a second invitation to the same address must invalidate the first,
   * or a withdrawn-and-reissued invitation leaves two live links.
   */
  const [, invitation] = await prisma.$transaction([
    prisma.invitation.updateMany({
      where: { organizationId: context.organizationId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.invitation.create({
      data: {
        organizationId: context.organizationId,
        email,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        invitedByUserId: context.actor.userId,
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
  ]);

  return { invitation, token };
}

export async function revokeInvitation(
  db: TenantClient,
  id: string,
  now: Date = new Date(),
): Promise<void> {
  // updateMany, not update: the tenant filter is in the where clause, so an id
  // from another business matches nothing rather than throwing.
  const { count } = await db.invitation.updateMany({
    where: { id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });

  if (count === 0) throw notFound('That invitation does not exist.');
}

export type ResolvedInvitation = {
  id: string;
  email: string;
  role: Role;
  organizationName: string;
  /** Whether the address already has an account, which decides the next step. */
  hasAccount: boolean;
};

/**
 * Looks up an invitation by its token, for the public acceptance page.
 *
 * Uses the base client, not a tenant client, because there is no session here —
 * and the organization comes *out of* the row rather than from the request. The
 * token is 256 bits of randomness, so holding one is the proof of invitation; the
 * business name is shown on the strength of that, the same way the public quote
 * page shows a customer their own quote.
 */
export async function resolveInvitation(
  token: string,
  now: Date = new Date(),
): Promise<ResolvedInvitation | null> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      acceptedAt: true,
      revokedAt: true,
      expiresAt: true,
      organization: { select: { name: true } },
    },
  });

  if (!invitation) return null;
  if (invitation.acceptedAt !== null) return null;
  if (invitation.revokedAt !== null) return null;
  if (invitation.expiresAt.getTime() <= now.getTime()) return null;

  const account = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    organizationName: invitation.organization.name,
    hasAccount: account !== null,
  };
}

export type AcceptedInvitation = {
  userId: string;
  organizationId: string;
  sessionVersion: number;
};

/**
 * Takes up an invitation, creating the account if there is not one yet.
 *
 * `claim` is the conditional update that makes this single-use: two requests with
 * the same token cannot both get past it, because only one can move `acceptedAt`
 * off null. Everything after it happens inside one transaction, so a failure
 * halfway through does not leave a user with no membership — an account that
 * exists and belongs nowhere, which the login path would accept and then have
 * nothing to show.
 */
export async function acceptInvitation(
  token: string,
  credentials: { name: string; passwordHash: string } | null,
  now: Date = new Date(),
): Promise<AcceptedInvitation> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      acceptedAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (
    !invitation ||
    invitation.acceptedAt !== null ||
    invitation.revokedAt !== null ||
    invitation.expiresAt.getTime() <= now.getTime()
  ) {
    throw notFound('That invitation is no longer valid. Ask for a new one.');
  }

  const account = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, sessionVersion: true },
  });

  if (!account && !credentials) {
    // The caller was told `hasAccount: false` and sent nothing to create one.
    throw conflict('That invitation needs a name and a password.');
  }

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: now },
    });

    // Lost the race, or it was withdrawn between the read and here.
    if (claimed.count === 0) {
      throw notFound('That invitation is no longer valid. Ask for a new one.');
    }

    const user =
      account ??
      (await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash: credentials!.passwordHash,
          name: credentials!.name,
          // The invitation arrived at this address and was opened from it, which
          // is the same proof the verification email exists to collect.
          emailVerifiedAt: now,
        },
        select: { id: true, sessionVersion: true },
      }));

    await tx.membership.upsert({
      where: {
        userId_organizationId: { userId: user.id, organizationId: invitation.organizationId },
      },
      update: { status: MembershipStatus.ACTIVE, role: invitation.role, acceptedAt: now },
      create: {
        userId: user.id,
        organizationId: invitation.organizationId,
        role: invitation.role,
        status: MembershipStatus.ACTIVE,
        invitedAt: invitation.acceptedAt ?? now,
        acceptedAt: now,
      },
    });

    return {
      userId: user.id,
      organizationId: invitation.organizationId,
      sessionVersion: user.sessionVersion,
    };
  });
}

/**
 * Changes what someone may do.
 *
 * Both the current role and the new one have to be below the actor's: an ADMIN
 * cannot promote a STAFF member to ADMIN, because the result is a peer they could
 * not have created directly.
 */
export async function changeMemberRole(
  db: TenantClient,
  actor: { userId: string; role: Role },
  userId: string,
  role: Role,
): Promise<void> {
  const membership = await requireManageable(db, actor, userId);

  if (!outranks(actor.role, role)) {
    throw forbidden(
      `You cannot make someone ${roleLabel(role)} — that is your own level or above.`,
    );
  }

  if (membership.role === role) return;

  await db.membership.updateMany({ where: { userId }, data: { role } });
}

/**
 * Suspends someone's access, immediately.
 *
 * Suspended rather than deleted, and that is the deliberate choice: the person
 * stops being able to sign in on their very next request — `requireAuth` re-reads
 * the membership every time and refuses anything but ACTIVE — while the jobs they
 * completed keep pointing at a real name. Deleting the membership would leave the
 * history attributed to nobody, and "who did this job?" is a question a business
 * gets asked months later.
 */
export async function suspendMember(
  db: TenantClient,
  actor: { userId: string; role: Role },
  userId: string,
): Promise<void> {
  await requireManageable(db, actor, userId);
  await db.membership.updateMany({
    where: { userId },
    data: { status: MembershipStatus.SUSPENDED },
  });
}

/** Puts a suspended teammate back to work. Counts against the seat limit again. */
export async function restoreMember(
  db: TenantClient,
  actor: { userId: string; role: Role },
  plan: PlanTier,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await requireManageable(db, actor, userId);

  const seats = await seatUsage(db, plan, now);
  if (seats.full) {
    throw conflict(
      `Your plan includes ${seats.limit} ${seats.limit === 1 ? 'seat' : 'seats'} and ${seats.used} ${seats.used === 1 ? 'is' : 'are'} in use. Upgrade before restoring someone.`,
    );
  }

  await db.membership.updateMany({
    where: { userId },
    data: { status: MembershipStatus.ACTIVE },
  });
}

/**
 * The shared guard: the target is in this business, is not the actor, and is
 * outranked by them.
 *
 * "Not the actor" is not politeness. Without it an owner can demote or suspend
 * themselves, and a business whose only owner is now STAFF has nobody who can put
 * it back — a locked door with the key on the inside.
 */
/**
 * Setting what somebody is paid.
 *
 * Deliberately not routed through `requireManageable`: that guard refuses any
 * self-action, which is right for roles and wrong here. The rule instead is
 * `canSetPay` — an owner or admin, acting on themselves or on somebody they
 * outrank — so an owner-operator can cost their own hours while an admin still
 * cannot quietly look up or rewrite the owner's pay.
 *
 * Null is a real value: it clears the rate and takes the labour line back out of
 * every cost view, which is different from setting it to zero.
 */
export async function setMemberPayRate(
  db: TenantClient,
  actor: { userId: string; role: Role },
  userId: string,
  hourlyRateCents: number | null,
): Promise<void> {
  const membership = await db.membership.findFirst({
    where: { userId },
    select: { role: true },
  });

  // Scoped by the tenant client, so somebody else's teammate is simply not here.
  if (!membership) throw notFound('That teammate does not exist.');

  if (!canSetPay(actor, { userId, role: membership.role })) {
    throw forbidden(
      actor.role === Role.OWNER || actor.role === Role.ADMIN
        ? `You cannot set the pay of someone who is ${roleLabel(membership.role)}.`
        : 'Only an owner or admin can set pay rates.',
    );
  }

  await db.membership.updateMany({ where: { userId }, data: { hourlyRateCents } });
}

async function requireManageable(
  db: TenantClient,
  actor: { userId: string; role: Role },
  userId: string,
): Promise<{ role: Role }> {
  if (userId === actor.userId) {
    throw forbidden('You cannot change your own role or access.');
  }

  const membership = await db.membership.findFirst({
    where: { userId },
    select: { role: true },
  });

  // Scoped by the tenant client, so somebody else's teammate is simply not here.
  if (!membership) throw notFound('That teammate does not exist.');

  if (!outranks(actor.role, membership.role)) {
    throw forbidden(`You cannot change someone who is ${roleLabel(membership.role)}.`);
  }

  return membership;
}

export function roleLabel(role: Role): string {
  switch (role) {
    case Role.OWNER:
      return 'an owner';
    case Role.ADMIN:
      return 'an admin';
    case Role.STAFF:
      return 'crew';
    default:
      return 'a teammate';
  }
}
