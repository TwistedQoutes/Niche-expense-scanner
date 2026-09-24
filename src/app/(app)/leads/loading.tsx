import { BoardSkeleton } from '@/components/ui/PageSkeleton';

/** Shaped like the real screen, so the layout does not jump when it lands. */
export default function LeadsLoading() {
  return <BoardSkeleton columns={5} />;
}
