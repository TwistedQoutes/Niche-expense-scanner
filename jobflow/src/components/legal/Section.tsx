import type { ReactNode } from 'react';

import { getPublicConfig } from '@/lib/env';

/** The date the legal text last changed. Update it when you edit the wording. */
export const LAST_UPDATED = '11 September 2026';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

/**
 * The support address, read from configuration.
 *
 * Hard-coding it would guarantee it goes stale, and a legal document promising
 * an address nobody reads is worse than no address at all.
 */
export function ContactEmail() {
  const address = getPublicConfig().supportEmail;
  return (
    <a href={`mailto:${address}`} className="text-brand-600 dark:text-brand-400 hover:underline">
      {address}
    </a>
  );
}

export function Disclaimer() {
  return (
    <p className="border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
      This document is a plain-language starting point written for a small independent product. It
      is not legal advice, and it has not been reviewed by a lawyer. Before charging customers —
      particularly customers in the EU or UK — have it checked by someone qualified in your
      jurisdiction.
    </p>
  );
}
