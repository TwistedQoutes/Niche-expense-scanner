import { MIN_CONFIDENCE, classifyExpense } from '@/lib/categories/classify';
import { type CategoryId } from '@/lib/categories/taxonomy';
import { apportionCents } from '@/lib/money';
import { extractLineItems, type ReceiptLineItem } from '@/lib/ocr/parse-receipt';

/** One category's proposed share of a receipt. */
export type SuggestedLine = {
  label: string;
  amountCents: number;
  category: CategoryId;
  categoryConfidence: number;
};

/** How many labels to name before falling back to "+N more". */
const LABELS_SHOWN = 2;

/** A receipt split more ways than this is noise, not insight. */
export const MAX_LINES = 12;

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= LABELS_SHOWN) return labels.join(', ');
  return `${labels.slice(0, LABELS_SHOWN).join(', ')} +${labels.length - LABELS_SHOWN} more`;
}

/**
 * Proposes a split of one receipt across categories.
 *
 * Grouped **by category, not by line item**: a supplier order with four needle
 * products and one bottle of ink is a two-way split, not a five-way one. The
 * artist cares which Schedule C line the money lands on, not how many SKUs the
 * supplier printed.
 *
 * The receipt's full total is apportioned across the groups pro-rata to their
 * item amounts, which does two useful things at once: tax and any shipping
 * spread across categories in proportion to what caused them, and the parts sum
 * to the total exactly, so a split can never disagree with the receipt it came
 * from.
 *
 * Returns null when there is nothing worth suggesting — fewer than two
 * categories, no usable line items, or no known total. A wrong split is more
 * annoying to unpick than no split, so the bar to suggest one is deliberately
 * high.
 */
export function suggestSplit(rawText: string, totalCents: number | null): SuggestedLine[] | null {
  if (totalCents === null || totalCents <= 0) return null;

  const items = extractLineItems(rawText);
  if (items.length < 2) return null;

  // Classify each product line on its own text. The merchant is deliberately
  // left out here: as a weak prior it would nudge every line towards the same
  // category and flatten the very distinction we are looking for.
  type Group = { labels: string[]; weight: number; confidenceSum: number; count: number };
  const groups = new Map<CategoryId, Group>();

  for (const item of items) {
    const match = classifyExpense({ rawText: item.label });

    // An unrecognised product is left in its own bucket rather than being
    // folded into whichever category happened to score highest overall.
    const group = groups.get(match.category) ?? {
      labels: [],
      weight: 0,
      confidenceSum: 0,
      count: 0,
    };

    group.labels.push(item.label);
    group.weight += item.amountCents;
    group.confidenceSum += match.confidence;
    group.count += 1;
    groups.set(match.category, group);
  }

  if (groups.size < 2 || groups.size > MAX_LINES) return null;

  // If nothing was recognised at all, a "split" into one OTHER bucket per item
  // tells the artist nothing.
  const recognised = [...groups.keys()].filter((category) => category !== 'OTHER');
  if (recognised.length === 0) return null;

  // A split is only offered when at least one group is confidently identified;
  // otherwise this is guesswork dressed up as a suggestion.
  const entries = [...groups.entries()];
  const bestConfidence = Math.max(
    ...entries.map(([, group]) => group.confidenceSum / group.count),
  );
  if (bestConfidence < MIN_CONFIDENCE) return null;

  const amounts = apportionCents(
    totalCents,
    entries.map(([, group]) => group.weight),
  );

  const lines = entries.map(([category, group], index) => ({
    label: joinLabels(group.labels),
    amountCents: amounts[index] ?? 0,
    category,
    categoryConfidence: Math.round((group.confidenceSum / group.count) * 100) / 100,
  }));

  // Largest share first: it is the one worth checking.
  lines.sort((a, b) => b.amountCents - a.amountCents);

  // A zero-value line would be a category the artist has to delete by hand.
  return lines.filter((line) => line.amountCents > 0);
}

/**
 * The single-line fallback: an unsplit receipt still gets one line, so the rest
 * of the app has exactly one shape to read.
 */
export function singleLine(
  amountCents: number,
  category: CategoryId,
  options: { label?: string | null; confidence?: number; source?: 'auto' | 'manual' } = {},
): {
  label: string | null;
  amountCents: number;
  category: CategoryId;
  categoryConfidence: number;
  categorySource: 'auto' | 'manual';
} {
  return {
    label: options.label ?? null,
    amountCents,
    category,
    categoryConfidence: options.confidence ?? 0,
    categorySource: options.source ?? 'auto',
  };
}

export type { ReceiptLineItem };
