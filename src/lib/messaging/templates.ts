/**
 * Filling in `{{placeholders}}`.
 *
 * Deliberately not a template language. There are no conditionals, no loops and
 * no expressions — just named substitution from a flat map of strings that the
 * server assembled from real records. A template is edited by a business owner
 * and then rendered on the server, so anything evaluable would be a small
 * scripting engine driven by user input.
 */

/** Every value a template may refer to. All optional; all plain strings. */
export type TemplateValues = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  business_name?: string | null;
  business_phone?: string | null;
  service?: string | null;
  address?: string | null;
  quote_number?: string | null;
  quote_url?: string | null;
  quote_total?: string | null;
  review_url?: string | null;
  job_number?: string | null;
};

export type RenderResult = {
  text: string;
  /** Placeholders that had no value. Surfaced so a template can be fixed. */
  missing: string[];
  /** Placeholders in the template that are not ones we know how to fill. */
  unknown: string[];
};

const KNOWN_KEYS = new Set<keyof TemplateValues>([
  'first_name',
  'last_name',
  'full_name',
  'business_name',
  'business_phone',
  'service',
  'address',
  'quote_number',
  'quote_url',
  'quote_total',
  'review_url',
  'job_number',
]);

/** Human-friendly stand-ins, so a gap never reads as a bug to the customer. */
const FALLBACKS: Partial<Record<keyof TemplateValues, string>> = {
  first_name: 'there',
  service: 'the work',
  address: 'your property',
};

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Renders a template against values.
 *
 * An unresolvable placeholder becomes a fallback where one reads naturally
 * ("Hi there,") and is otherwise removed entirely. It is never left as
 * `{{first_name}}`: a customer receiving raw template syntax is the most
 * visible possible bug, and it makes the business look automated in the worst
 * way. The gap is reported to the caller instead.
 */
export function renderTemplate(template: string, values: TemplateValues): RenderResult {
  const missing: string[] = [];
  const unknown: string[] = [];

  const text = template.replace(PLACEHOLDER, (_match, rawKey: string) => {
    const key = rawKey.trim() as keyof TemplateValues;

    if (!KNOWN_KEYS.has(key)) {
      unknown.push(rawKey);
      return '';
    }

    const value = values[key];
    if (value !== undefined && value !== null && String(value).trim().length > 0) {
      return String(value);
    }

    missing.push(rawKey);
    return FALLBACKS[key] ?? '';
  });

  // Substitution leaves double spaces and stranded punctuation where a value was
  // dropped — ", ." reads as a typo the owner will be blamed for.
  const tidied = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/,\s*\./g, '.')
    .trim();

  return { text: tidied, missing, unknown };
}

/** The placeholders a template refers to, for validation in the editor. */
export function placeholdersIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]!.trim());
}

/** Placeholders a template uses that we cannot fill. */
export function unknownPlaceholders(template: string): string[] {
  return [
    ...new Set(
      placeholdersIn(template).filter((key) => !KNOWN_KEYS.has(key as keyof TemplateValues)),
    ),
  ];
}

export const AVAILABLE_PLACEHOLDERS = [...KNOWN_KEYS];
