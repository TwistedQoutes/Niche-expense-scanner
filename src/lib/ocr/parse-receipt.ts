import { MAX_AMOUNT_CENTS, parseAmountToCents } from '@/lib/money';
import { toUtcMidnight } from '@/lib/dates';

/**
 * Turns raw OCR text into the four fields an expense actually needs:
 * merchant, total, date and tax.
 *
 * Receipts have no schema — every supplier prints a different layout, and OCR
 * adds its own noise on top. So this is a scoring parser, not a matcher: it
 * collects every plausible candidate for each field, ranks them by evidence,
 * and reports a per-field confidence. The UI shows its work and lets the artist
 * correct anything, which is far more useful than a parser that pretends to be
 * certain.
 */

export type ParsedField<T> = {
  value: T | null;
  confidence: number;
};

export type ParsedReceipt = {
  merchant: ParsedField<string>;
  amountCents: ParsedField<number>;
  taxCents: ParsedField<number>;
  spentAt: ParsedField<string>; // YYYY-MM-DD
  currency: string;
};

/** Lines that look like a total, strongest label first. */
const TOTAL_LABELS: readonly { regex: RegExp; weight: number }[] = [
  { regex: /\bgrand\s*total\b/, weight: 10 },
  { regex: /\btotal\s*due\b/, weight: 9 },
  { regex: /\b(?:amount|balance)\s*due\b/, weight: 9 },
  { regex: /\b(?:order|invoice|purchase)\s*total\b/, weight: 8 },
  { regex: /\btotal\s*(?:paid|charged)\b/, weight: 8 },
  { regex: /\byou\s*(?:paid|pay)\b/, weight: 7 },
  { regex: /\btotal\b/, weight: 6 },
  { regex: /\bcharged?\b/, weight: 4 },
];

/**
 * Lines that contain a "total"-ish word but are never the amount we want.
 * Getting this wrong is the most common way a receipt parser reports the
 * subtotal, the tax, or the cash tendered as the expense.
 */
const TOTAL_EXCLUSIONS =
  /\bsub[\s-]*total\b|\btotal\s+(?:items?|qty|quantity|units?|savings?|discounts?|tax)\b|\bchange\s*due\b|\btender(?:ed)?\b|\bcash\s*back\b|\bloyalty\b|\bpoints\b|\bsavings\b/;

const TAX_LABELS = /\b(?:sales\s*tax|state\s*tax|local\s*tax|tax|vat|gst|hst)\b/;
const TAX_EXCLUSIONS = /\btax\s*(?:id|number|no|exempt|free)\b|\bein\b/;

/** Amounts: require a decimal part or a currency symbol, so quantities are not candidates. */
const AMOUNT_PATTERN = /(?:([$£€])\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))(?!\d)|([$£€])\s*(\d{1,3}(?:,\d{3})*)(?!\.?\d)/g;

const CURRENCY_BY_SYMBOL: Record<string, string> = { $: 'USD', '£': 'GBP', '€': 'EUR' };

function detectCurrency(text: string): string {
  if (/£/.test(text)) return 'GBP';
  if (/€/.test(text)) return 'EUR';
  if (/\b(?:gbp|pounds?\s*sterling)\b/i.test(text)) return 'GBP';
  if (/\beur\b/i.test(text)) return 'EUR';
  return 'USD';
}

type AmountCandidate = { cents: number; hadSymbol: boolean };

/**
 * Ways a receipt writes "this money went the other way".
 *
 * AMOUNT_PATTERN starts at the digits, so a minus sign or an accounting
 * bracket sits outside the match and has to be read from the surrounding text.
 */
const NEGATIVE_BEFORE = /[-−–—(]\s*$/;
const NEGATIVE_AFTER = /^\s*(?:-|\)|CR\b)/i;

/** Every money-shaped token on one line, left to right. */
function extractAmounts(line: string): AmountCandidate[] {
  const found: AmountCandidate[] = [];
  AMOUNT_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = AMOUNT_PATTERN.exec(line)) !== null) {
    const [, decimalSymbol, whole, fraction, wholeSymbol, wholeOnly] = match;

    const raw =
      whole !== undefined && fraction !== undefined
        ? `${whole}.${fraction}`
        : wholeOnly !== undefined
          ? wholeOnly
          : null;
    if (raw === null) continue;

    // A refund reads "TOTAL -45.00". Matching only the digits turned that into
    // a 45.00 *expense* — a credit noted as a deduction, which is exactly the
    // direction of error that gets an artist in trouble. An amount we can see
    // is negative is dropped: this product has no way to represent one, and no
    // suggestion at all is better than a confident wrong sign.
    const negative =
      NEGATIVE_BEFORE.test(line.slice(0, match.index)) ||
      NEGATIVE_AFTER.test(line.slice(match.index + match[0].length));
    if (negative) continue;

    const cents = parseAmountToCents(raw);
    if (cents === null || cents <= 0 || cents > MAX_AMOUNT_CENTS) continue;

    found.push({ cents, hadSymbol: Boolean(decimalSymbol ?? wholeSymbol) });
  }

  return found;
}

/** True when the text reads like a refund or credit note rather than a purchase. */
export function looksLikeRefund(rawText: string): boolean {
  const wording = /\b(?:refund(?:ed)?|credit\s*note|store\s+credit|returned\s+(?:to|for))\b/i;
  // A total that is written negative, however the till spells it.
  const negativeTotal = /\b(?:total|amount\s+due|balance)\b[^\n]*?(?:[-−–—]\s*(?:[$£€]\s*)?\d|\(\s*(?:[$£€]\s*)?\d[\d,]*\.\d{2}\s*\)|\d[\d,]*\.\d{2}\s*-)/i;

  return wording.test(rawText) || negativeTotal.test(rawText);
}

/** Split into trimmed, non-empty lines with the original casing preserved. */
function toLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

function findTotal(lines: string[]): ParsedField<number> {
  type Scored = { cents: number; score: number; labelled: boolean };
  const candidates: Scored[] = [];

  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    const amounts = extractAmounts(line);
    if (amounts.length === 0) return;

    // On a labelled line the amount is the right-most one ("TOTAL 3 items 45.99").
    const lineAmount = amounts[amounts.length - 1];
    if (!lineAmount) return;

    if (TOTAL_EXCLUSIONS.test(lower)) return;

    const label = TOTAL_LABELS.find((entry) => entry.regex.test(lower));
    if (label) {
      // Totals live at the bottom; a late match is more likely the real one.
      const positionBonus = (index / Math.max(1, lines.length - 1)) * 3;
      candidates.push({
        cents: Math.max(...amounts.map((amount) => amount.cents)),
        score: label.weight + positionBonus,
        labelled: true,
      });
      return;
    }

    // Unlabelled fallback: a currency-marked amount is weak evidence on its own.
    if (lineAmount.hadSymbol) {
      candidates.push({ cents: lineAmount.cents, score: 1, labelled: false });
    }
  });

  if (candidates.length === 0) {
    // Last resort: the largest amount anywhere on the receipt. Frequently right
    // for a simple till receipt, so worth offering — at low confidence.
    const everything = lines.flatMap(extractAmounts);
    if (everything.length === 0) return { value: null, confidence: 0 };
    const largest = Math.max(...everything.map((amount) => amount.cents));
    return { value: largest, confidence: 0.25 };
  }

  candidates.sort((a, b) => b.score - a.score || b.cents - a.cents);
  const best = candidates[0]!;

  const labelledCount = candidates.filter((candidate) => candidate.labelled).length;
  const confidence = best.labelled
    ? // A single clearly-labelled total is the happy path; competing labels mean
      // subtotal/total/tax confusion, so trust it a little less.
      Math.min(0.95, 0.7 + Math.min(best.score, 12) / 40 - (labelledCount > 1 ? 0.1 : 0))
    : 0.4;

  return { value: best.cents, confidence: Math.round(confidence * 100) / 100 };
}

function findTax(lines: string[]): ParsedField<number> {
  for (const line of [...lines].reverse()) {
    const lower = line.toLowerCase();
    if (!TAX_LABELS.test(lower) || TAX_EXCLUSIONS.test(lower)) continue;
    if (/\bsub[\s-]*total\b|\btotal\s*due\b/.test(lower)) continue;

    const amounts = extractAmounts(line);
    const last = amounts[amounts.length - 1];
    if (last) return { value: last.cents, confidence: 0.75 };
  }
  return { value: null, confidence: 0 };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function plausible(year: number, month: number, day: number, now: Date): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;

  // A receipt cannot be from tomorrow, and one from a decade ago is almost
  // certainly a misread of something else on the page.
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tenYearsAgo = new Date(Date.UTC(now.getUTCFullYear() - 10, now.getUTCMonth(), now.getUTCDate()));
  return date <= tomorrow && date >= tenYearsAgo;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Finds a receipt date across the formats suppliers actually print.
 *
 * Numeric day/month order is genuinely ambiguous (03/04/2026), so the parser
 * uses the one disambiguating signal available — a value above 12 must be the
 * day — and otherwise assumes US order, reporting lower confidence to nudge the
 * artist to glance at it.
 */
function findDate(lines: string[], now: Date): ParsedField<string> {
  const text = lines.join('\n');

  // 1. ISO — unambiguous, so it wins outright.
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const [, year, month, day] = iso as unknown as [string, string, string, string];
    if (plausible(Number(year), Number(month), Number(day), now)) {
      return { value: `${year}-${month}-${day}`, confidence: 0.95 };
    }
  }

  // 2. Textual months: "Sep 10, 2026", "10 September 2026".
  const textual =
    /\b(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/i.exec(text) ??
    /\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(text);
  if (textual) {
    const groups = textual.slice(1) as string[];
    const monthToken = groups.find((group) => /[a-z]{3}/i.test(group));
    const monthNumber = monthToken ? MONTHS[monthToken.slice(0, 3).toLowerCase()] : undefined;
    const numbers = groups.filter((group) => /^\d+$/.test(group)).map(Number);
    const year = numbers.find((value) => value > 31);
    const day = numbers.find((value) => value <= 31);

    if (monthNumber && year && day && plausible(year, monthNumber, day, now)) {
      return { value: `${year}-${pad(monthNumber)}-${pad(day)}`, confidence: 0.9 };
    }
  }

  // 3. Numeric slash/dot formats, preferring a line that says "date".
  const orderedLines = [
    ...lines.filter((line) => /\bdate\b/i.test(line)),
    ...lines.filter((line) => !/\bdate\b/i.test(line)),
  ];

  for (const line of orderedLines) {
    NUMERIC_DATE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = NUMERIC_DATE_PATTERN.exec(line)) !== null) {
      const parts = [match[1]!, match[2]!, match[3]!] as DateParts;
      const interpreted = interpretNumericDate(parts, now);

      if (interpreted) {
        const labelled = /\bdate\b/i.test(line);
        return {
          value: interpreted.value,
          confidence: Math.min(0.9, interpreted.confidence + (labelled ? 0.1 : 0)),
        };
      }
    }
  }

  // 4. Last resort: repair a single mis-read digit.
  return repairNumericDate(orderedLines, now) ?? { value: null, confidence: 0 };
}

const NUMERIC_DATE_PATTERN = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/g;

/** `[first, second, year]` as printed, before day/month order is resolved. */
type DateParts = [string, string, string];

/**
 * Resolves a numeric date, handling the day/month ambiguity.
 *
 * A component above 12 can only be the day, which settles the order outright.
 * When both are 12 or below the order is genuinely unknowable from the receipt
 * alone, so US order is assumed and the confidence drops to say so.
 */
function interpretNumericDate(parts: DateParts, now: Date): ParsedField<string> | null {
  const [first, second, rawYear] = parts;

  if (!/^\d{1,2}$/.test(first) || !/^\d{1,2}$/.test(second) || !/^\d{2,4}$/.test(rawYear)) return null;

  const yearNumber = Number(rawYear);
  const year = rawYear.length === 2 ? 2000 + yearNumber : yearNumber;

  const a = Number(first);
  const b = Number(second);

  const orderings: { month: number; day: number; confidence: number }[] =
    a > 12
      ? [{ month: b, day: a, confidence: 0.85 }]
      : b > 12
        ? [{ month: a, day: b, confidence: 0.85 }]
        : [
            { month: a, day: b, confidence: 0.6 }, // US convention
            { month: b, day: a, confidence: 0.5 },
          ];

  for (const ordering of orderings) {
    if (plausible(year, ordering.month, ordering.day, now)) {
      return {
        value: `${year}-${pad(ordering.month)}-${pad(ordering.day)}`,
        confidence: ordering.confidence,
      };
    }
  }

  return null;
}

/**
 * Digit pairs Tesseract confuses on receipt print, keyed by what it reported.
 *
 * This is not theoretical: a test scan of "09/03/2026" came back as
 * "89/03/2026". Without a repair pass the date is simply dropped, the form
 * quietly defaults to today, and the expense lands in the wrong month — which
 * is worse than being obviously wrong, because nobody notices.
 */
const DIGIT_CONFUSIONS: Record<string, readonly string[]> = {
  '0': ['8', '9', '6'],
  '1': ['7', '4'],
  '2': ['7'],
  '3': ['8', '9', '5'],
  '4': ['1', '9'],
  '5': ['6', '8', '3'],
  '6': ['0', '5', '8'],
  '7': ['1', '2'],
  '8': ['0', '3', '6'],
  '9': ['0', '4'],
};

/**
 * Tries every single-character repair of a date that failed to parse.
 *
 * The safety rule is unanimity: a repair is only accepted when *exactly one*
 * plausible date comes out of all the substitutions. If two different repairs
 * both look valid there is no way to choose, so nothing is returned. The
 * confidence is capped low either way, so the review screen always flags a
 * repaired date for a human glance.
 */
function repairNumericDate(lines: string[], now: Date): ParsedField<string> | null {
  for (const line of lines) {
    NUMERIC_DATE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = NUMERIC_DATE_PATTERN.exec(line)) !== null) {
      const original = [match[1]!, match[2]!, match[3]!] as DateParts;
      const candidates = new Set<string>();

      for (let part = 0; part < 3; part += 1) {
        const token = original[part]!;

        for (let index = 0; index < token.length; index += 1) {
          for (const replacement of DIGIT_CONFUSIONS[token[index]!] ?? []) {
            const repairedParts = [...original] as DateParts;
            repairedParts[part] = token.slice(0, index) + replacement + token.slice(index + 1);

            const interpreted = interpretNumericDate(repairedParts, now);
            if (interpreted?.value) candidates.add(interpreted.value);
          }
        }
      }

      if (candidates.size === 1) {
        return { value: [...candidates][0]!, confidence: 0.45 };
      }
    }
  }

  return null;
}

/** Lines at the top of a receipt that are never the merchant name. */
const MERCHANT_NOISE =
  /^(?:receipt|invoice|tax\s*invoice|order|sales?\s*receipt|customer\s*copy|merchant\s*copy|thank\s*you|welcome|tel|phone|fax|vat|reg|no\.?|www\.|http|order\s*#)/i;

function looksLikeAddress(line: string): boolean {
  return (
    /\b(?:street|st\.|road|rd\.|avenue|ave\.|suite|ste\.|unit|floor|blvd|lane|ln\.)\b/i.test(line) ||
    /^\d+\s+\w+/.test(line) ||
    /\b\d{5}(?:-\d{4})?\b/.test(line) ||
    /^[\d\s()+-]{7,}$/.test(line)
  );
}

/**
 * Picks the merchant from the header block.
 *
 * The name is almost always in the first few lines, printed larger and often in
 * capitals — which OCR flattens, so the heuristics lean on what survives:
 * position, letter content, and the absence of address/phone/label markers.
 */
function findMerchant(lines: string[]): ParsedField<string> {
  const header = lines.slice(0, 8);

  let best: { name: string; score: number } | null = null;

  header.forEach((line, index) => {
    if (line.length < 3 || line.length > 60) return;
    if (MERCHANT_NOISE.test(line)) return;
    if (looksLikeAddress(line)) return;

    const letters = line.replace(/[^a-z]/gi, '').length;
    if (letters < 3) return;
    // Mostly-digits lines are receipt numbers, dates or totals.
    if (letters / line.length < 0.5) return;

    let score = 10 - index * 1.5;
    // Supplier names are rarely one short word, and rarely a whole sentence.
    if (line.split(' ').length <= 5) score += 1;
    if (/^[A-Z0-9 &'.,-]+$/.test(line)) score += 1.5; // printed in caps
    if (/\b(?:tattoo|supply|supplies|ink|studio|co\.?|inc\.?|ltd\.?|llc)\b/i.test(line)) score += 2;

    if (!best || score > best.score) best = { name: line, score };
  });

  if (!best) return { value: null, confidence: 0 };

  const winner: { name: string; score: number } = best;
  return {
    value: tidyMerchantName(winner.name),
    confidence: Math.round(Math.min(0.9, 0.35 + winner.score / 20) * 100) / 100,
  };
}

/** "KINGPIN TATTOO SUPPLY  ***" → "Kingpin Tattoo Supply". */
export function tidyMerchantName(raw: string): string {
  const cleaned = raw.replace(/[*|_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[,.]$/, '');

  // Only re-case shouty text; a name the merchant already mixed-cased is left alone.
  if (cleaned !== cleaned.toUpperCase()) return cleaned;

  return cleaned
    .toLowerCase()
    .split(' ')
    .map((word) => (word.length <= 1 ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ');
}

/** One product line off a receipt: what it was, and what it cost. */
export type ReceiptLineItem = {
  label: string;
  amountCents: number;
};

/**
 * Lines that carry an amount but are not products.
 *
 * Getting this list wrong is what turns a tidy three-way split into a
 * six-way one containing "SUBTOTAL", "VISA" and "CHANGE DUE".
 */
const LINE_ITEM_EXCLUSIONS =
  /\b(?:sub[\s-]*total|total|tax|vat|gst|hst|change|cash|tender(?:ed)?|balance|due|payment|paid|visa|mastercard|maestro|amex|debit|credit|card|contactless|approved|auth|invoice|receipt|order\s*#|date|tel|phone|fax|thank|discount|savings|loyalty|points|qty|quantity)\b/i;

/** Trailing amount, leading quantity and OCR artefacts stripped off a product line. */
function tidyItemLabel(line: string): string {
  return line
    // The amount we just read off the end.
    .replace(/(?:[$£€]\s*)?\d{1,3}(?:,\d{3})*\.\d{2}\s*$/, '')
    // A leading quantity: "2 ", "3 x ", "1 @ ".
    .replace(/^\s*\d{1,3}\s*(?:x|@)?\s+/i, '')
    .replace(/[*|_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,.]$/, '');
}

/**
 * Pulls the product lines out of a receipt.
 *
 * This is what makes splitting automatic rather than manual: a supplier invoice
 * already lists needles, ink and gloves as separate lines with their own
 * amounts, so the split is sitting there in the text — it just has to be read
 * and classified line by line.
 *
 * Conservative by design. A line has to have both a real description (three or
 * more letters) and a trailing decimal amount to count, so quantities, card
 * digits and layout noise are skipped rather than becoming phantom line items.
 */
export function extractLineItems(rawText: string): ReceiptLineItem[] {
  const items: ReceiptLineItem[] = [];

  for (const line of toLines(rawText)) {
    if (LINE_ITEM_EXCLUSIONS.test(line)) continue;

    const amounts = extractAmounts(line);
    const amount = amounts[amounts.length - 1];
    if (!amount || amount.cents <= 0) continue;

    const label = tidyItemLabel(line);
    // A description that is mostly digits is a reference number, not a product.
    if (label.replace(/[^a-z]/gi, '').length < 3) continue;

    items.push({ label, amountCents: amount.cents });
  }

  return items;
}

export function parseReceiptText(rawText: string, now: Date = new Date()): ParsedReceipt {
  const lines = toLines(rawText);
  const currency = detectCurrency(rawText);

  const amountCents = findTotal(lines);
  const taxCents = findTax(lines);

  // A tax value that is not smaller than the total means one of the two was
  // misread; dropping the tax is the safer of the two corrections.
  const taxIsCoherent =
    taxCents.value !== null && (amountCents.value === null || taxCents.value < amountCents.value);

  return {
    merchant: findMerchant(lines),
    amountCents,
    taxCents: taxIsCoherent ? taxCents : { value: null, confidence: 0 },
    spentAt: findDate(lines, toUtcMidnight(now)),
    currency,
  };
}

export { CURRENCY_BY_SYMBOL };
