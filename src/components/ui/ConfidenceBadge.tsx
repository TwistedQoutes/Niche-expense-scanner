import { cn } from '@/lib/cn';

/**
 * Shows how sure the scanner is about one field.
 *
 * The point is honesty: a parser working on a photograph of crumpled thermal
 * paper will sometimes be wrong, and an artist who can see *which* field is
 * shaky will fix that one field instead of distrusting the whole app.
 */
export function ConfidenceBadge({
  confidence,
  missing = false,
  className,
}: {
  confidence: number;
  /** True when the scanner found nothing for this field at all. */
  missing?: boolean;
  className?: string;
}) {
  if (missing) {
    // Short enough to sit in a half-width column on a phone: the longer wording
    // this used to carry wrapped, and a rounded pill split across two lines
    // renders as a broken shape. `inline-block` keeps the background whole if a
    // narrower screen wraps it anyway.
    return (
      <span
        className={cn(
          'inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
          className,
        )}
      >
        Couldn&rsquo;t read this
      </span>
    );
  }

  // The same treatment for the graded labels, which are short but share a row
  // with field text that can push them onto a second line.

  const tone =
    confidence >= 0.75
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
      : confidence >= 0.5
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';

  const label = confidence >= 0.75 ? 'Confident' : confidence >= 0.5 ? 'Check this' : 'Unsure';

  return (
    <span
      className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', tone, className)}
      title={`Scanner confidence: ${Math.round(confidence * 100)}%`}
    >
      {label}
    </span>
  );
}
