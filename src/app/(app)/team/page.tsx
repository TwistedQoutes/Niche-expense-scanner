import { Role } from '@prisma/client';
import type { Metadata } from 'next';

import { TeamManager } from '@/components/team/TeamManager';
import { requireAuth, hasRole } from '@/lib/auth/context';
import { effectivePlan } from '@/lib/billing/usage';
import { emailEnabled } from '@/lib/email';
import { listTeam, seatUsage } from '@/lib/team/repository';

export const metadata: Metadata = { title: 'Team' };
export const dynamic = 'force-dynamic';

/**
 * Who is in the business.
 *
 * Visible to everyone, actionable only by ADMIN and up. A crew member seeing the
 * names of the people they work beside is not a disclosure — and the same list is
 * what the "assign to" selector on a job draws from, so hiding it would leave that
 * selector unexplainable.
 */
export default async function TeamPage() {
  const auth = await requireAuth();

  const plan = effectivePlan(auth.subscription);
  const [team, seats] = await Promise.all([
    listTeam(auth.db, { userId: auth.user.id, role: auth.role }),
    seatUsage(auth.db, plan),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Team</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Invite the people who work with you, and decide what each of them can reach.
        </p>
      </header>

      <TeamManager
        members={team.members}
        invites={team.invites}
        seats={seats}
        canInvite={hasRole(auth, Role.ADMIN)}
        emailConfigured={emailEnabled()}
        isDemo={auth.organization.isDemo}
      />
    </div>
  );
}
