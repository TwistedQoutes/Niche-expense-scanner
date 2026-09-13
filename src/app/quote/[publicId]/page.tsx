import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { QuoteStatus } from '@prisma/client';

import { QuoteResponse } from '@/components/quotes/QuoteResponse';
import { AppError } from '@/lib/api/errors';
import { formatDateLabel } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { publicOrganization, resolvePublicQuote } from '@/lib/quotes/public';
import { effectiveStatus, getQuoteByIdOrPublicId } from '@/lib/quotes/repository';

/**
 * The customer's view of a quote.
 *
 * No login, no navigation, no app shell — this is a document, and the only thing
 * on the page is the offer and the three things a customer can do about it. It
 * is also the only page in the product a stranger will ever see, so it carries
 * the business's branding rather than ours.
 *
 * Mobile-first for a literal reason: it arrives as a text message.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your quote',
  // A customer's price and address have no business in search results, and a
  // quote URL is a credential — an indexed one is a leaked one.
  robots: { index: false, follow: false, nocache: true },
};

export default async function PublicQuotePage(props: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await props.params;

  let scope;
  try {
    scope = await resolvePublicQuote(publicId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') notFound();
    throw error;
  }

  const [quote, business] = await Promise.all([
    getQuoteByIdOrPublicId(scope.db, { publicId }),
    publicOrganization(scope.organizationId),
  ]);

  // A draft is not an offer. Its publicId exists from the moment it is created,
  // so without this a customer handed the link early would see a price the owner
  // had not finished deciding on.
  if (quote.status === QuoteStatus.DRAFT) notFound();

  const status = effectiveStatus(quote);
  const currency = quote.currency || business.currency;

  const responseState =
    status === QuoteStatus.ACCEPTED
      ? 'accepted'
      : status === QuoteStatus.DECLINED
        ? 'declined'
        : status === QuoteStatus.EXPIRED
          ? 'expired'
          : status === QuoteStatus.CHANGES_REQUESTED
            ? 'changes'
            : 'open';

  const customerName = quote.customer
    ? [quote.customer.firstName, quote.customer.lastName].filter(Boolean).join(' ')
    : null;

  const propertyAddress = [
    quote.property?.addressLine1 ?? quote.customer?.addressLine1,
    quote.property?.city ?? quote.customer?.city,
    quote.property?.state ?? quote.customer?.state,
    quote.property?.postalCode ?? quote.customer?.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  const includedItems = quote.items.filter((item) => !item.optional);
  const optionalItems = quote.items.filter((item) => item.optional);

  return (
    <div className="min-h-dvh bg-slate-100 py-6 dark:bg-slate-950 sm:py-10">
      <main className="mx-auto w-full max-w-2xl px-4">
        <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          {/* ── Business header ───────────────────────────────────────── */}
          <header className="border-b border-slate-100 px-5 py-5 dark:border-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {business.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={business.logoUrl}
                    alt={business.name}
                    className="mb-2 h-10 w-auto object-contain"
                  />
                ) : null}

                <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {business.name}
                </h1>

                <div className="mt-1 space-y-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {business.phone ? <p>{business.phone}</p> : null}
                  {business.email ? <p>{business.email}</p> : null}
                  {business.website ? <p>{business.website}</p> : null}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
                  Quote
                </p>
                <p className="tabular text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {quote.number}
                </p>
                {quote.sentAt ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {formatDateLabel(quote.sentAt, business.timezone)}
                  </p>
                ) : null}
              </div>
            </div>
          </header>

          {/* ── Who and where ─────────────────────────────────────────── */}
          {customerName || propertyAddress ? (
            <section className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <p className="text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
                Prepared for
              </p>
              {customerName ? (
                <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {customerName}
                </p>
              ) : null}
              {propertyAddress ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">{propertyAddress}</p>
              ) : null}
            </section>
          ) : null}

          {/* ── The work ──────────────────────────────────────────────── */}
          <section className="px-5 py-5">
            {quote.title ? (
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {quote.title}
              </h2>
            ) : null}

            {quote.summary ? (
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {quote.summary}
              </p>
            ) : null}

            <div className="mt-5">
              <p className="text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
                What is included
              </p>

              <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                {includedItems.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800 dark:text-slate-200">{item.name}</p>
                      {item.description ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {item.description}
                        </p>
                      ) : null}
                      {item.quantityMilli !== 1000 ? (
                        <p className="tabular text-xs text-slate-500 dark:text-slate-400">
                          {(item.quantityMilli / 1000).toLocaleString()} ×{' '}
                          {formatCents(item.unitPriceCents, currency)}
                        </p>
                      ) : null}
                    </div>

                    <span className="tabular shrink-0 text-sm text-slate-800 dark:text-slate-200">
                      {formatCents(item.totalCents, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {optionalItems.length > 0 ? (
              <div className="mt-5">
                <p className="text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
                  Optional extras
                </p>
                <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                  {optionalItems.map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-4 py-2.5">
                      <p className="text-sm text-slate-600 dark:text-slate-400">{item.name}</p>
                      <span className="tabular shrink-0 text-sm text-slate-600 dark:text-slate-400">
                        {formatCents(item.totalCents, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Not included in the total below — mention them if you would like them added.
                </p>
              </div>
            ) : null}
          </section>

          {/* ── Money ─────────────────────────────────────────────────── */}
          <section className="border-t border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/40">
            <dl className="space-y-1.5 text-sm">
              {quote.discountCents > 0 || quote.taxCents > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">Subtotal</dt>
                  <dd className="tabular text-slate-800 dark:text-slate-200">
                    {formatCents(quote.subtotalCents + quote.discountCents, currency)}
                  </dd>
                </div>
              ) : null}

              {quote.discountCents > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">Discount</dt>
                  <dd className="tabular text-brand-700 dark:text-brand-400">
                    −{formatCents(quote.discountCents, currency)}
                  </dd>
                </div>
              ) : null}

              {quote.taxCents > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-slate-600 dark:text-slate-400">
                    Tax ({(quote.taxRateBps / 100).toFixed(2)}%)
                  </dt>
                  <dd className="tabular text-slate-800 dark:text-slate-200">
                    {formatCents(quote.taxCents, currency)}
                  </dd>
                </div>
              ) : null}

              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
                <dt className="font-semibold text-slate-900 dark:text-slate-50">Total</dt>
                <dd className="tabular text-2xl font-bold text-slate-900 dark:text-slate-50">
                  {formatCents(quote.totalCents, currency)}
                </dd>
              </div>
            </dl>

            {quote.expiresAt && responseState === 'open' ? (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                This price is held until {formatDateLabel(quote.expiresAt, business.timezone)}.
              </p>
            ) : null}
          </section>

          {/* ── Decision ──────────────────────────────────────────────── */}
          <section className="px-5 py-5">
            <QuoteResponse
              publicId={publicId}
              businessName={business.name}
              initialStatus={responseState}
            />
          </section>

          {/* ── Terms ─────────────────────────────────────────────────── */}
          {quote.terms ? (
            <footer className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
              <p className="text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
                Terms
              </p>
              <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-slate-600 dark:text-slate-400">
                {quote.terms}
              </p>
            </footer>
          ) : null}
        </article>

        <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
          {[business.addressLine1, business.city, business.state, business.postalCode]
            .filter(Boolean)
            .join(', ')}
        </p>
      </main>
    </div>
  );
}
