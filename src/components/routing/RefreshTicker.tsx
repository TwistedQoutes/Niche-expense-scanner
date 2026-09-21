'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps "right now" actually now.
 *
 * A server-rendered page showing live positions is stale the moment it is
 * painted, and a stale page about where people are is worse than most stale
 * pages: somebody reads "at the property" and tells a customer the crew has
 * arrived, when that was true twenty minutes ago.
 *
 * A router refresh rather than a polling fetch, because the page is a server
 * component and this keeps one rendering path instead of two — the same markup,
 * re-rendered, rather than a client-side copy of it that could drift.
 *
 * Only while the tab is actually being looked at. A forgotten tab on a laptop in
 * an office would otherwise refresh all night, which is load nobody asked for
 * and a needless read of where people are.
 */
export function RefreshTicker({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };

    const timer = setInterval(tick, everyMs);

    // And immediately on coming back to the tab, rather than up to a minute later.
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, everyMs]);

  return null;
}
