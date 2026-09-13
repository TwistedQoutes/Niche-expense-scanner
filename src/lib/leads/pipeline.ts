import { LeadStatus } from '@prisma/client';

import type { BadgeTone } from '@/components/ui/Badge';

/**
 * The pipeline, defined once.
 *
 * The board, the filters, the analytics funnel and the status menu all read
 * this, so a status cannot exist in one place and be missing from another.
 */

export type PipelineColumn = {
  status: LeadStatus;
  label: string;
  /** Shown as the column's one-line explanation on an empty board. */
  hint: string;
  tone: BadgeTone;
  /** True when the lead has left the pipeline — no longer work in progress. */
  terminal: boolean;
};

export const PIPELINE: PipelineColumn[] = [
  {
    status: LeadStatus.NEW,
    label: 'New',
    hint: 'Just arrived. Nobody has spoken to them yet.',
    tone: 'info',
    terminal: false,
  },
  {
    status: LeadStatus.CONTACTED,
    label: 'Contacted',
    hint: 'You have reached out and are waiting to hear back.',
    tone: 'active',
    terminal: false,
  },
  {
    status: LeadStatus.QUALIFIED,
    label: 'Qualified',
    hint: 'Real job, in your area, worth quoting.',
    tone: 'active',
    terminal: false,
  },
  {
    status: LeadStatus.QUOTE_PENDING,
    label: 'Quote pending',
    hint: 'You still owe them a price.',
    tone: 'urgent',
    terminal: false,
  },
  {
    status: LeadStatus.QUOTE_SENT,
    label: 'Quote sent',
    hint: 'Waiting on their decision. Follow-up runs automatically.',
    tone: 'pending',
    terminal: false,
  },
  {
    status: LeadStatus.NEGOTIATING,
    label: 'Negotiating',
    hint: 'They want changes to the price or the scope.',
    tone: 'pending',
    terminal: false,
  },
  {
    status: LeadStatus.WON,
    label: 'Won',
    hint: 'Accepted. Becomes a customer and a job.',
    tone: 'success',
    terminal: true,
  },
  {
    status: LeadStatus.LOST,
    label: 'Lost',
    hint: 'Gone elsewhere, or not a fit.',
    tone: 'danger',
    terminal: true,
  },
];

const BY_STATUS = new Map(PIPELINE.map((column) => [column.status, column]));

export function columnFor(status: LeadStatus): PipelineColumn {
  const column = BY_STATUS.get(status);
  if (!column) {
    throw new Error(`No pipeline column defined for status "${status}".`);
  }
  return column;
}

/** Statuses that still count as open work, for "how much is in play" figures. */
export const OPEN_STATUSES = PIPELINE.filter((column) => !column.terminal).map(
  (column) => column.status,
);

/**
 * Ordering inside a column.
 *
 * Positions are spaced far apart rather than numbered 1, 2, 3, so dropping a
 * card between two others is a single UPDATE on that one row — take the
 * midpoint of its new neighbours — instead of renumbering everything below it.
 * With a gap of 65536 a column takes sixteen consecutive drops in the same slot
 * before the midpoints run out, and `positionBetween` reports that so the
 * caller can respace.
 */
export const POSITION_GAP = 65_536;

export type PositionResult =
  | { kind: 'position'; position: number }
  /** No integer fits between the neighbours; the column must be respaced. */
  | { kind: 'respace' };

export function positionBetween(
  above: number | null,
  below: number | null,
): PositionResult {
  // Dropped into an empty column.
  if (above === null && below === null) return { kind: 'position', position: POSITION_GAP };

  // Dropped at the top: half the gap above the current first card. Halving
  // rather than subtracting a fixed gap keeps positions positive forever.
  if (above === null) {
    const first = below!;
    if (first <= 1) return { kind: 'respace' };
    return { kind: 'position', position: Math.floor(first / 2) };
  }

  // Dropped at the bottom: a full gap below the last card.
  if (below === null) {
    return { kind: 'position', position: above + POSITION_GAP };
  }

  // Between two cards. There must be room for an integer strictly between them.
  if (below - above <= 1) return { kind: 'respace' };

  return { kind: 'position', position: Math.floor((above + below) / 2) };
}

/** Evenly spaced positions for a whole column, used when respacing. */
export function respacedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * POSITION_GAP);
}
