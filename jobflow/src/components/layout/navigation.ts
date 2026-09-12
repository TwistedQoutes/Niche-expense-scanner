/**
 * The application's navigation, defined once.
 *
 * The sidebar, the mobile bottom bar and the command palette all read this, so
 * a new screen appears in every surface at once and cannot end up reachable
 * from one and invisible in another.
 *
 * Order is the order of the work: capture a lead, understand the customer,
 * price it, do it, get paid, bring them back. It is the pipeline, top to bottom.
 */

export type NavItem = {
  href: string;
  label: string;
  /** Shown in the mobile bar, which has room for five. */
  primary?: boolean;
  /** Requires ADMIN or above. */
  admin?: boolean;
  /**
   * Whether the screen behind this entry exists yet.
   *
   * The map below is the finished product, written down once so each phase
   * knows where its work belongs. Rendering an entry whose route has not been
   * built would put a 404 inside the app's own navigation, so the sidebar and
   * the mobile bar filter on this flag and a phase flips its entries on as it
   * lands.
   */
  built: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Pipeline',
    items: [
      { href: '/dashboard', label: 'Dashboard', primary: true, built: true },
      { href: '/leads', label: 'Leads', primary: true, built: true },
      { href: '/customers', label: 'Customers', built: true },
      { href: '/quotes', label: 'Quotes', primary: true, built: true },
    ],
  },
  {
    title: 'Delivery',
    items: [
      { href: '/jobs', label: 'Jobs', primary: true, built: true },
      { href: '/calendar', label: 'Calendar', primary: true, built: true },
      { href: '/messages', label: 'Messages', built: true },
    ],
  },
  {
    title: 'Growth',
    items: [
      { href: '/automations', label: 'Automations', built: true },
      { href: '/reviews', label: 'Reviews', built: true },
      { href: '/analytics', label: 'Analytics', built: false },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { href: '/pricing-settings', label: 'Pricing', admin: true, built: true },
      { href: '/settings', label: 'Settings', built: true },
      { href: '/billing', label: 'Billing', admin: true, built: false },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export const PRIMARY_NAV: NavItem[] = ALL_NAV_ITEMS.filter((item) => item.primary && item.built);

/**
 * Which nav item a path belongs to.
 *
 * Longest prefix wins, so `/quotes/abc` highlights Quotes rather than whichever
 * shorter route happens to be listed first. `/dashboard` is matched exactly —
 * without that, every path starting with a slash would match it.
 */
export function activeHref(pathname: string): string | null {
  const candidates = ALL_NAV_ITEMS.map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length);

  return candidates[0] ?? null;
}
