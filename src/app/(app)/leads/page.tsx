import type { Metadata } from 'next';
import Link from 'next/link';

import { PipelineBoard } from '@/components/leads/PipelineBoard';
import type { BoardLead } from '@/components/leads/LeadCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { requireAuth } from '@/lib/auth/context';
import { loadBoard } from '@/lib/leads/repository';

export const metadata: Metadata = { title: 'Leads' };
export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const auth = await requireAuth();
  const board = await loadBoard(auth.db);

  // Dates cannot cross the server/client boundary inside a client component's
  // props without being serialised, so they go over as ISO strings and are
  // parsed back where they are formatted.
  const leads: BoardLead[] = [...board.values()].flat().map((lead) => ({
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: lead.phone,
    email: lead.email,
    city: lead.city,
    status: lead.status,
    serviceRequested: lead.serviceRequested,
    estimatedValueCents: lead.estimatedValueCents,
    aiScore: lead.aiScore,
    aiUrgency: lead.aiUrgency,
    nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    followUpOverdue: lead.followUpOverdue,
  }));

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Leads</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Drag a card, or use the menu on it, to move someone along.
          </p>
        </div>

        <Link href="/leads/new">
          <Button size="sm">New lead</Button>
        </Link>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
          <EmptyState
            title="No leads yet"
            description="Add one by hand to see how the pipeline works, or wait for your first enquiry to arrive."
            action={
              <Link href="/leads/new">
                <Button size="sm">Add a lead</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <PipelineBoard initialLeads={leads} currency={auth.organization.currency} />
      )}
    </div>
  );
}
