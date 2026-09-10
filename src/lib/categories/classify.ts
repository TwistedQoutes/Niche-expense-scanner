import {
  CATEGORIES,
  CATEGORY_IDS,
  MERCHANT_HINTS,
  type CategoryId,
} from '@/lib/categories/taxonomy';

export type CategoryMatch = {
  category: CategoryId;
  /** 0–1. Below MIN_CONFIDENCE the UI asks the artist to confirm. */
  confidence: number;
  /** The terms that drove the decision — shown in the UI so the guess is auditable. */
  matchedTerms: string[];
  /** Next-best candidates, offered as one-tap alternatives. */
  alternatives: { category: CategoryId; confidence: number }[];
};

/** Guesses below this are surfaced as "needs review" rather than silently trusted. */
export const MIN_CONFIDENCE = 0.45;

/**
 * Lower-case, strip accents, and collapse everything that is not a letter,
 * digit or currency-relevant character into a single space.
 *
 * OCR output is full of layout noise ("N E E D L E S", "3RL |", "GLOVES**"), so
 * normalising first is what makes plain phrase matching viable.
 */
export function normaliseText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.,/$£€\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matchers are compiled once per module load, not per receipt.
 *
 * Word boundaries matter: without them "ink" matches "drinking" and "mask"
 * matches "damaged", which is exactly the kind of silent mis-categorisation
 * that makes an artist stop trusting the app.
 */
type CompiledRule = {
  /** Global flag: used to count every occurrence in the receipt body. */
  regex: RegExp;
  /** Same source without the global flag, for a cheap merchant-line test. */
  merchantRegex: RegExp;
  weight: number;
  /** Literal phrase, or null for a regex rule whose matched text is reported instead. */
  term: string | null;
};

const RULES_BY_CATEGORY: Record<CategoryId, CompiledRule[]> = Object.fromEntries(
  CATEGORY_IDS.map((id) => {
    const definition = CATEGORIES[id];
    const rules: CompiledRule[] = [
      ...definition.keywords.map(([term, weight]) => {
        const source = `\\b${escapeRegExp(term)}\\b`;
        return {
          term,
          weight,
          regex: new RegExp(source, 'g'),
          merchantRegex: new RegExp(source),
        };
      }),
      // A pattern has no readable term of its own, so `null` here tells the
      // matcher to report the text it actually found on the receipt ("3rl")
      // rather than the regex source.
      ...(definition.patterns ?? []).map(([source, weight]) => ({
        term: null,
        weight,
        regex: new RegExp(source, 'g'),
        merchantRegex: new RegExp(source),
      })),
    ];
    return [id, rules];
  }),
) as Record<CategoryId, CompiledRule[]>;

const MERCHANT_RULES = MERCHANT_HINTS.map((hint) => ({
  category: hint.category,
  regex: new RegExp(`\\b${escapeRegExp(hint.pattern)}`),
  term: hint.pattern,
}));

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Repeat mentions add signal, but with diminishing returns. */
function occurrenceMultiplier(count: number): number {
  if (count <= 1) return 1;
  return 1 + Math.min(count - 1, 3) * 0.25;
}

export type ClassifyInput = {
  merchant?: string | null;
  /** Full OCR text of the receipt — the richest signal available. */
  rawText?: string | null;
  notes?: string | null;
};

/**
 * Scores every category against the receipt and returns the best match.
 *
 * Deliberately a transparent rule engine rather than a model: an artist can be
 * told *why* something landed in "Aftercare", the behaviour is unit-testable,
 * it costs nothing per scan, and no receipt data leaves the server.
 */
export function classifyExpense(input: ClassifyInput): CategoryMatch {
  const merchant = normaliseText(input.merchant ?? '');
  const body = normaliseText([input.rawText ?? '', input.notes ?? ''].join('\n'));

  // The merchant line is short and high-signal, so it is weighted up; but it is
  // also included in the body so a supplier name in the OCR text still counts.
  const haystack = `${merchant} ${body}`.trim();

  const scores = new Map<CategoryId, number>();
  const matchedTerms = new Map<CategoryId, Set<string>>();

  if (haystack.length > 0) {
    for (const id of CATEGORY_IDS) {
      let score = 0;
      const terms = new Set<string>();

      for (const rule of RULES_BY_CATEGORY[id]) {
        rule.regex.lastIndex = 0;
        const matches = haystack.match(rule.regex);
        const occurrences = matches?.length ?? 0;
        if (occurrences === 0) continue;

        score += rule.weight * occurrenceMultiplier(occurrences);
        // Everything surfaced here is shown to the artist, so it has to be
        // something they can recognise from their own receipt.
        terms.add(rule.term ?? matches![0]!.trim());

        // A hit in the merchant name is worth more than one buried in a footer.
        if (merchant.length > 0 && rule.merchantRegex.test(merchant)) {
          score += rule.weight * 0.5;
        }
      }

      if (score > 0) {
        scores.set(id, score);
        matchedTerms.set(id, terms);
      }
    }
  }

  // Weak supplier prior: only enough to break a tie or rescue an empty result.
  for (const hint of MERCHANT_RULES) {
    if (!merchant || !hint.regex.test(merchant)) continue;
    scores.set(hint.category, (scores.get(hint.category) ?? 0) + 1.2);
    const terms = matchedTerms.get(hint.category) ?? new Set<string>();
    terms.add(hint.term);
    matchedTerms.set(hint.category, terms);
  }

  scores.delete('OTHER');

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, score]) => ({ category, score }));

  const best = ranked[0];
  if (!best) {
    return { category: 'OTHER', confidence: 0, matchedTerms: [], alternatives: [] };
  }

  const runnerUpScore = ranked[1]?.score ?? 0;

  // Confidence combines two ideas: how much evidence there is at all, and how
  // clearly the winner beat the runner-up. Both have to hold for a high score,
  // so "one weak keyword" and "two equally plausible categories" both stay low.
  const evidence = best.score / (best.score + 3);
  const margin = (best.score - runnerUpScore) / best.score;
  const confidence = round2(Math.min(1, evidence * (0.6 + 0.4 * margin)));

  return {
    category: best.category,
    confidence,
    matchedTerms: [...(matchedTerms.get(best.category) ?? [])].slice(0, 6),
    // Alternatives are scaled off the winner's confidence by their share of its
    // score, so a runner-up can never be reported as more likely than the pick
    // that beat it.
    alternatives: ranked.slice(1, 4).map((entry) => ({
      category: entry.category,
      confidence: round2(confidence * (entry.score / best.score)),
    })),
  };
}
