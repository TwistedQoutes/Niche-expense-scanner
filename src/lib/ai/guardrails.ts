/**
 * What the AI is not allowed to say to a customer.
 *
 * The system prompt asks the model not to quote prices, promise a time slot, or
 * make legal and safety claims. That is worth doing and it is **not a control**:
 * a prompt is a request, and the text it shapes is partly written by whoever
 * filled in a public intake form. So every rule is also enforced here, on the
 * output, where it cannot be talked out of.
 *
 * Why these three:
 *
 *  - **A price the model invents is a price the business is on the hook for.**
 *    The only trustworthy number comes from the pricing engine, against rates the
 *    owner configured. A friendly "that'll be about $200" in a draft reply is how
 *    a business ends up doing a $340 job for $200.
 *  - **A promised time slot the calendar has not agreed to is a missed
 *    appointment.** Availability belongs to the calendar, not to a sentence.
 *  - **"Guaranteed", "certified", "safe", "insured" are claims with legal
 *    weight.** They may well be true of the business; they are not the model's to
 *    assert on its behalf.
 *
 * Findings are redacted rather than rejected. A draft with one phrase removed
 * and a warning attached is still useful to an owner; throwing the whole reply
 * away because of four words is not. Nothing here is ever sent without a person
 * reading it, which is what makes redaction the proportionate response.
 */

export type GuardrailFinding = {
  /** Machine-readable, so the UI can group without parsing prose. */
  rule: 'price' | 'availability' | 'legal_claim' | 'contact_detail';
  /** What was found, for the owner to judge. Truncated. */
  matched: string;
};

export type GuardrailResult = {
  /** The text with offending spans replaced. Safe to show the owner. */
  text: string;
  findings: GuardrailFinding[];
  /** True when anything was changed. */
  redacted: boolean;
};

const REPLACEMENT: Record<GuardrailFinding['rule'], string> = {
  price: '[price removed — send a quote instead]',
  availability: '[availability removed — check the calendar]',
  legal_claim: '[claim removed]',
  contact_detail: '[contact detail removed]',
};

/**
 * Money, in the shapes a model actually writes it.
 *
 * Deliberately broad. A false positive costs an owner one edit; a false negative
 * costs them the difference between the quoted price and the real one.
 */
const PRICE_PATTERNS: RegExp[] = [
  // $45, $1,250.00, $ 45
  /\$\s?\d[\d,]*(?:\.\d{1,2})?/g,
  // 45 dollars, 1,250 bucks
  /\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars?|bucks|usd)\b/gi,
  // "around 200 for the" — a bare number doing a price's job
  /\b(?:around|about|roughly|approximately|just|only|starting at|from)\s+\d[\d,]{1,8}(?:\.\d{1,2})?\b/gi,
  // per-unit rates: 35 an hour, 0.10 per sq ft
  /\b\d[\d,]*(?:\.\d{1,2})?\s?(?:\/|per\s|an?\s)\s?(?:hour|hr|day|visit|sq\s?ft|square\s?f(?:oo|ee)t|month|week)\b/gi,
];

/**
 * Committing to a time.
 *
 * The distinction being drawn is between *offering to arrange* something and
 * *stating that it is arranged*. "We can usually fit visits in this week" is
 * fine; "we'll be there Tuesday at 9" is a promise the calendar never made.
 */
const AVAILABILITY_PATTERNS: RegExp[] = [
  /\b(?:we(?:'| a)?re|i(?:'| a)?m|we will|we'll|i will|i'll)\s+(?:be\s+)?(?:there|able to come|coming|out|over|available)\b[^.!?]*/gi,
  /\b(?:can|could|will)\s+(?:come|be there|do it|fit you in|get to you)\s+(?:on\s+)?(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this\s+\w+|next\s+\w+)\b[^.!?]*/gi,
  /\b(?:booked|scheduled|confirmed)\s+(?:you\s+)?(?:in\s+)?for\b[^.!?]*/gi,
];

const LEGAL_CLAIM_PATTERNS: RegExp[] = [
  /\b(?:guarantee[ds]?|guaranteeing|warrant(?:y|ied|ed)|100%\s+\w+)\b[^.!?]*/gi,
  /\b(?:fully\s+)?(?:licensed|insured|bonded|certified|accredited)\b[^.!?]*/gi,
  /\b(?:completely|totally|perfectly|entirely)\s+(?:safe|risk[- ]free|harmless)\b[^.!?]*/gi,
  /\b(?:non[- ]toxic|pet[- ]safe|child[- ]safe|eco[- ]certified)\b[^.!?]*/gi,
];

/**
 * Contact details the model made up.
 *
 * A hallucinated phone number or address in a customer-facing reply sends that
 * customer to a stranger. The business's real details are templated in by us,
 * not written by the model, so any that appear here are suspect by construction.
 */
const CONTACT_PATTERNS: RegExp[] = [
  /*
   * A lookbehind rather than a leading \b, so an opening parenthesis is part of
   * the match instead of being left behind.
   *
   * `\b` does not assert between a space and "(", so the match used to start at
   * the first digit and "(555) 123-4567" redacted to "([contact detail
   * removed]". The number was gone — the security property held — but the draft
   * an owner reads had a stray bracket in it, which looks like the product is
   * broken rather than careful.
   */
  /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\bhttps?:\/\/\S+/gi,
];

const RULES: { rule: GuardrailFinding['rule']; patterns: RegExp[] }[] = [
  { rule: 'price', patterns: PRICE_PATTERNS },
  { rule: 'availability', patterns: AVAILABILITY_PATTERNS },
  { rule: 'legal_claim', patterns: LEGAL_CLAIM_PATTERNS },
  { rule: 'contact_detail', patterns: CONTACT_PATTERNS },
];

/*
 * Sentinels used to lift `{{placeholders}}` out of the text while the rules run.
 *
 * Unicode private-use characters, not NUL. An earlier version used \u0000, which
 * worked at runtime and made this a *binary file* as far as git and grep are
 * concerned — no diffs on review, and some tooling refuses to read it at all.
 * These two code points are reserved for private use, so no model output and no
 * customer's message will ever contain them.
 */
const SENTINEL_OPEN = '\uE000';
const SENTINEL_CLOSE = '\uE001';
const SENTINEL_PATTERN = /\uE000(\d+)\uE001/g;

/**
 * Applies every rule to a draft customer message.
 *
 * Placeholders like `{{first_name}}` are left alone: they are ours, filled in at
 * send time from real data, and a rule that mangled them would break every
 * template the product ships.
 */
export function applyGuardrails(input: string): GuardrailResult {
  const findings: GuardrailFinding[] = [];

  // Placeholders are lifted out before scanning and put back after, so a rule
  // can never match inside one.
  const placeholders: string[] = [];
  let text = input.replace(/\{\{[\w.]+\}\}/g, (match) => {
    placeholders.push(match);
    return `${SENTINEL_OPEN}${placeholders.length - 1}${SENTINEL_CLOSE}`;
  });

  for (const { rule, patterns } of RULES) {
    for (const pattern of patterns) {
      text = text.replace(new RegExp(pattern.source, pattern.flags), (match) => {
        const trimmed = match.trim();
        if (trimmed.length === 0) return match;

        findings.push({ rule, matched: trimmed.slice(0, 120) });
        return REPLACEMENT[rule];
      });
    }
  }

  text = text.replace(SENTINEL_PATTERN, (_match, index: string) => {
    return placeholders[Number(index)] ?? '';
  });

  // Redaction leaves ragged whitespace behind; tidy it so the owner is reading a
  // draft rather than a diff.
  const tidied = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return { text: tidied, findings, redacted: findings.length > 0 };
}

/** Human wording for a finding, for the warning shown beside a draft. */
export function describeFinding(rule: GuardrailFinding['rule']): string {
  switch (rule) {
    case 'price':
      return 'It tried to quote a price. Send a quote from the pricing engine instead — that is the only number backed by your rates.';
    case 'availability':
      return 'It promised a time. Check your calendar before committing to one.';
    case 'legal_claim':
      return 'It made a claim about licensing, safety or a guarantee. Say that yourself only if it is true of your business.';
    case 'contact_detail':
      return 'It included a phone number, email or link that it may have invented.';
    default:
      return 'Something was removed from this draft.';
  }
}

/**
 * Clamps a model-supplied score into the documented range.
 *
 * A score outside 0–100 is not a small formatting problem: it is rendered as a
 * badge and sorted on, so a 7000 would dominate every pipeline view. Non-numeric
 * and missing values become null rather than zero, because "not scored" and
 * "scored zero" mean opposite things to an owner deciding what to work on.
 */
export function clampScore(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}
