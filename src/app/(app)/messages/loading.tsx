import { ListSkeleton } from '@/components/ui/PageSkeleton';

/** Shaped like the real screen, so the layout does not jump when it lands. */
export default function MessagesLoading() {
  return <ListSkeleton rows={8} />;
}
