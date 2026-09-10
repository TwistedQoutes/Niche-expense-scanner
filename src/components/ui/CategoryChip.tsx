import { cn } from '@/lib/cn';
import { categoryOf } from '@/lib/categories/taxonomy';

export function CategoryChip({
  category,
  className,
  showSource,
  source,
}: {
  category: string;
  className?: string;
  showSource?: boolean;
  source?: 'auto' | 'manual';
}) {
  const definition = categoryOf(category);

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        definition.chipClass,
        className,
      )}
    >
      <span className="truncate">{definition.label}</span>
      {showSource && source === 'auto' ? (
        // A quiet marker that the scanner chose this, not the artist — so a
        // wrong guess is easy to spot when reviewing a month.
        <span aria-label="categorised automatically" title="Categorised automatically">
          ✨
        </span>
      ) : null}
    </span>
  );
}
