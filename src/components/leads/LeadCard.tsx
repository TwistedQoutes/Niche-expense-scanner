'use client';

import Link from 'next/link';
import { LeadStatus, Urgency } from '@prisma/client';

import { Badge } from '@/components/ui/Badge';
import { PIPELINE } from '@/lib/leads/pipeline';
import { cn } from '@/lib/cn';
import { formatCentsCompact } from '@/lib/money';
import { formatRelative } from '@/lib/dates';

export type BoardLead = {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  status: LeadStatus;
  serviceRequested: string | null;
  estimatedValueCents: number | null;
  aiScore: number | null;
  aiUrgency: Urgency | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  /**
   * Resolved server-side. Reading the clock during render is impure — the same
   * card would render differently on a re-render that changed nothing — so
   * "overdue as of when the page loaded" is computed with the data.
   */
  followUpOverdue: boolean;
};

/** A score is only worth showing once it means something. */
function scoreTone(score: number) {
  if (score >= 80) return 'success' as const;
  if (score >= 50) return 'pending' as const;
  return 'neutral' as const;
}

export function LeadCard({
  lead,
  currency,
  onMove,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  lead: BoardLead;
  currency: string;
  onMove: (leadId: string, status: LeadStatus) => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ');

  return (
    <li
      // HTML5 drag works on pointer devices and does nothing on touch, which is
      // why the status menu below is not a fallback but the primary path on a
      // phone — see the note in PipelineBoard.
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-xl bg-white p-3 ring-1 ring-slate-200 transition dark:bg-slate-900 dark:ring-slate-800',
        dragging ? 'opacity-40' : 'hover:ring-slate-300 dark:hover:ring-slate-700',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/leads/${lead.id}`}
          className="min-w-0 flex-1 text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
        >
          {name}
        </Link>

        {lead.aiScore !== null ? (
          <Badge tone={scoreTone(lead.aiScore)}>{lead.aiScore}</Badge>
        ) : null}
      </div>

      {lead.serviceRequested ? (
        <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-400">
          {lead.serviceRequested}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {lead.estimatedValueCents !== null ? (
          <span className="tabular font-medium text-slate-700 dark:text-slate-300">
            {formatCentsCompact(lead.estimatedValueCents, currency)}
          </span>
        ) : null}

        {lead.city ? <span>{lead.city}</span> : null}

        <span>{formatRelative(new Date(lead.createdAt))}</span>
      </div>

      {lead.aiUrgency === Urgency.HIGH || lead.aiUrgency === Urgency.EMERGENCY ? (
        <div className="mt-2">
          <Badge tone="urgent">
            {lead.aiUrgency === Urgency.EMERGENCY ? 'Emergency' : 'Urgent'}
          </Badge>
        </div>
      ) : null}

      {lead.followUpOverdue ? (
        <div className="mt-2">
          <Badge tone="danger">Follow-up overdue</Badge>
        </div>
      ) : null}

      {/*
        The accessible and mobile path for changing status. A native select is
        deliberate: it is keyboard-operable, screen-reader-labelled, and on a
        phone it opens the OS picker — which beats dragging a card with a thumb
        while standing in someone's yard.
      */}
      <label className="mt-2 block">
        <span className="sr-only">Move {name} to another stage</span>
        <select
          value={lead.status}
          onChange={(event) => onMove(lead.id, event.target.value as LeadStatus)}
          className="w-full rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
        >
          {PIPELINE.map((column) => (
            <option key={column.status} value={column.status}>
              {column.label}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}
