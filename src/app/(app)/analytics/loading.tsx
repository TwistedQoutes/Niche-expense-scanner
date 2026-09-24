import { ListSkeleton } from '@/components/ui/PageSkeleton';

/** Shaped like the real screen, so the layout does not jump when it lands. */
export default function AnalyticsLoading() {
  return <ListSkeleton rows={6} stats={4} />;
}
