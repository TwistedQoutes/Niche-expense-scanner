import { ListSkeleton } from '@/components/ui/PageSkeleton';

/** Shaped like the real screen, so the layout does not jump when it lands. */
export default function QuotesLoading() {
  return <ListSkeleton rows={8} stats={4} />;
}
