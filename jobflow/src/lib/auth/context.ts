import {
  MembershipStatus,
  OrganizationStatus,
  type PlanTier,
  type Role,
  type SubscriptionStatus,
} from '@prisma/client';

import { AppError, forbidden, unauthorized } from '@/lib/api/errors';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { forOrganization, type TenantClient } from '@/lib/db/tenant';

/**
 * The authenticated request context.
 *
 * Everything downstream — route handlers, server components, the pricing
 * engine — receives this rather than reaching for the session itself, so the
 * three questions that decide whether a request may proceed are answered once:
 * who is this, which business are they acting in, and what may they do there.
 */
export type AuthContext = {
  user: {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    emailVerifiedAt: Date | null;
    isPlatformAdmin: boolean;
  };
  organization: {
    id: string;
    slug: string;
    name: string;
    industry: string;
    timezone: string;
    currency: string;
    status: OrganizationStatus;
    onboardedAt: Date | null;
    isDemo: boolean;
  };
  role: Role;
  subscription: {
    plan: PlanTier;
    status: SubscriptionStatus;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
  } | null;
  /**
   * A Prisma client pinned to this organization. Use it for every tenant-owned
   * query; it makes reaching another tenant's rows impossible rather than
   * merely discouraged.
   */
  db: TenantClient;
};

/**
 * Resolves the signed-in user and their active organization, or throws.
 *
 * The JWT is self-contained, but the membership is still read back on every
 * request. That costs one indexed query and buys three things a token cannot
 * express: a removed teammate loses access immediately rather than when their
 * token expires, a suspended business stops working the moment billing says so,
 * and a changed role takes effect without a re-login.
 */
export async function requireAuth(): Promise<AuthContext> {
  const session = await getSession();
  if (!session) throw unauthorized();

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: session.userId,
        organizationId: session.organizationId,
      },
    },
    select: {
      role: true,
      status: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          emailVerifiedAt: true,
          isPlatformAdmin: true,
          sessionVersion: true,
        },
      },
      organization: {
        select: {
          id: true,
          slug: true,
          name: true,
          industry: true,
          timezone: true,
          currency: true,
          status: true,
          onboardedAt: true,
          isDemo: true,
          subscription: {
            select: {
              plan: true,
              status: true,
              trialEndsAt: true,
              currentPeriodEnd: true,
            },
          },
        },
      },
    },
  });

  // No membership means the user was removed from this business, or the
  // organization is gone. Either way the token is describing a world that no
  // longer exists.
  if (!membership) {
    throw unauthorized('Your access to this workspace has ended. Please sign in again.');
  }

  // The revocation check. A password change or "sign out everywhere" bumps the
  // stored version, and every token issued before that stops working here.
  if (membership.user.sessionVersion !== session.sessionVersion) {
    throw unauthorized('Your session has ended. Please sign in again.');
  }

  if (membership.status !== MembershipStatus.ACTIVE) {
    throw forbidden('Your access to this workspace has been suspended.');
  }

  if (membership.organization.status !== OrganizationStatus.ACTIVE) {
    throw forbidden(
      'This workspace is suspended. Contact support if you think that is a mistake.',
    );
  }

  const { user, organization } = membership;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      emailVerifiedAt: user.emailVerifiedAt,
      isPlatformAdmin: user.isPlatformAdmin,
    },
    organization: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      industry: organization.industry,
      timezone: organization.timezone,
      currency: organization.currency,
      status: organization.status,
      onboardedAt: organization.onboardedAt,
      isDemo: organization.isDemo,
    },
    role: membership.role,
    subscription: organization.subscription,
    db: forOrganization(organization.id),
  };
}

/** Non-throwing variant, for pages that render differently when signed out. */
export async function getAuth(): Promise<AuthContext | null> {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
}

/**
 * Why a page could not be rendered for this visitor.
 *
 * `signed_out` means there is no usable session and sending them to /login is
 * the whole story. The other three mean the *cookie is still valid* but the
 * database refuses it — a suspended workspace, a removed teammate, a revoked
 * session — and those need the cookie cleared before the redirect, or the proxy
 * (which can only see that a cookie exists) bounces them straight back and the
 * two redirect at each other forever. See src/app/api/auth/session-ended.
 */
export type AuthFailure = 'signed_out' | 'suspended' | 'removed' | 'expired';

export type AuthOutcome =
  | { ok: true; context: AuthContext }
  | { ok: false; reason: AuthFailure };

export async function resolveAuth(): Promise<AuthOutcome> {
  const session = await getSession();
  if (!session) return { ok: false, reason: 'signed_out' };

  try {
    return { ok: true, context: await requireAuth() };
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === 'forbidden') {
        return {
          ok: false,
          reason: error.message.includes('workspace is suspended') ? 'suspended' : 'removed',
        };
      }
      // A 401 with a cookie present means the token verified but the user,
      // membership or session version behind it did not.
      if (error.code === 'unauthorized') return { ok: false, reason: 'expired' };
    }
    throw error;
  }
}

/** Where to send a visitor whose request could not be authorised. */
export function redirectForFailure(reason: AuthFailure, returnTo?: string): string {
  if (reason === 'signed_out') {
    const suffix = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    return `/login${suffix}`;
  }
  return `/api/auth/session-ended?reason=${reason}`;
}

/**
 * Role hierarchy. OWNER can do anything an ADMIN can, and so on down — encoded
 * as ranks so a check is a comparison rather than a list of roles that has to
 * be updated everywhere a new role appears.
 */
const RANK: Record<Role, number> = { STAFF: 1, ADMIN: 2, OWNER: 3 };

export function hasRole(context: AuthContext, minimum: Role): boolean {
  return RANK[context.role] >= RANK[minimum];
}

/**
 * Requires at least `minimum`. Used on everything that changes money, billing,
 * pricing or who else can get in.
 */
export async function requireRole(minimum: Role): Promise<AuthContext> {
  const context = await requireAuth();
  if (!hasRole(context, minimum)) {
    throw forbidden('You do not have permission to do that.');
  }
  return context;
}

/** Gates the platform admin console — our staff, not a customer's. */
export async function requirePlatformAdmin(): Promise<AuthContext> {
  const context = await requireAuth();
  if (!context.user.isPlatformAdmin) {
    // Deliberately a 404-shaped message: an unauthorised prober should not
    // learn that /admin is a real surface.
    throw forbidden('Not found.');
  }
  return context;
}
