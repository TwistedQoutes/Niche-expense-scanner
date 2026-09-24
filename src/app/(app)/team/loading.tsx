import { ListSkeleton } from '@/components/ui/PageSkeleton';

/** Shaped like the real screen, so the layout does not jump when it lands. */
export default function TeamLoading() {
  return <ListSkeleton rows={5} />;
}
