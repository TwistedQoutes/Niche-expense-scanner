'use client';

import { LeadStatus } from '@prisma/client';
import { useCallback, useMemo, useState } from 'react';

import { LeadCard, type BoardLead } from '@/components/leads/LeadCard';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { ApiError, apiRequest } from '@/lib/api-client';
import { PIPELINE } from '@/lib/leads/pipeline';
import { cn } from '@/lib/cn';
import { formatCentsCompact } from '@/lib/money';

/**
 * The lead pipeline.
 *
 * Two ways to move a card, on purpose. Dragging is the obvious one on a desktop
 * and is what the board is for. But HTML5 drag-and-drop does nothing on touch,
 * and this product's users are on a phone in a truck more often than at a desk —
 * so every card also carries a status select. That is not a degraded fallback:
 * on a phone it is the better interaction, it is keyboard-operable, and a
 * screen reader can drive it. Shipping only the drag would have made the
 * primary screen unusable for the primary device.
 *
 * Moves are optimistic. A pipeline that freezes for 300ms every time a card is
 * dragged feels broken, so the board updates immediately and rolls back with a
 * toast if the server disagrees.
 */
export function PipelineBoard({
  initialLeads,
  currency,
}: {
  initialLeads: BoardLead[];
  currency: string;
}) {
  const toast = useToast();
  const [leads, setLeads] = useState(initialLeads);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<LeadStatus | null>(null);

  const byStatus = useMemo(() => {
    const grouped = new Map<LeadStatus, BoardLead[]>();
    for (const column of PIPELINE) grouped.set(column.status, []);
    for (const lead of leads) grouped.get(lead.status)?.push(lead);
    return grouped;
  }, [leads]);

  const move = useCallback(
    async (leadId: string, status: LeadStatus) => {
      const lead = leads.find((entry) => entry.id === leadId);
      if (!lead || lead.status === status) return;

      const previous = leads;
      // Optimistic: drop it at the top of the new column, which is where the
      // server puts a card with no neighbours below it.
      setLeads((current) =>
        current.map((entry) => (entry.id === leadId ? { ...entry, status } : entry)),
      );

      try {
        const target = byStatus.get(status) ?? [];
        await apiRequest(`/api/leads/${leadId}/move`, {
          method: 'PATCH',
          body: { status, beforeId: target[0]?.id ?? null },
        });
      } catch (error) {
        // Put it back. Leaving a card where the server refused to accept it is
        // worse than the move never appearing to happen.
        setLeads(previous);
        toast.error(
          error instanceof ApiError ? error.message : 'Could not move that lead. Try again.',
        );
      }
    },
    [leads, byStatus, toast],
  );

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {PIPELINE.map((column) => {
        const cards = byStatus.get(column.status) ?? [];
        const columnValue = cards.reduce((sum, card) => sum + (card.estimatedValueCents ?? 0), 0);
        const isTarget = overColumn === column.status;

        return (
          <section
            key={column.status}
            aria-label={column.label}
            onDragOver={(event) => {
              // Without preventDefault the browser refuses the drop outright.
              event.preventDefault();
              setOverColumn(column.status);
            }}
            onDragLeave={() => setOverColumn((current) => (current === column.status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setOverColumn(null);
              if (draggingId) void move(draggingId, column.status);
              setDraggingId(null);
            }}
            className={cn(
              'flex w-72 shrink-0 flex-col rounded-2xl bg-slate-100/70 p-2 transition-colors dark:bg-slate-900/60',
              isTarget && 'bg-brand-50 ring-brand-300 ring-2 dark:bg-brand-950/40 dark:ring-brand-800',
            )}
          >
            <header className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Badge tone={column.tone}>{column.label}</Badge>
                <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                  {cards.length}
                </span>
              </div>

              {columnValue > 0 ? (
                <span className="tabular text-xs font-medium text-slate-600 dark:text-slate-400">
                  {formatCentsCompact(columnValue, currency)}
                </span>
              ) : null}
            </header>

            {cards.length === 0 ? (
              <p className="px-2 pb-3 text-xs text-slate-500 dark:text-slate-500">{column.hint}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {cards.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    currency={currency}
                    onMove={(id, status) => void move(id, status)}
                    dragging={draggingId === lead.id}
                    onDragStart={() => setDraggingId(lead.id)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setOverColumn(null);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
