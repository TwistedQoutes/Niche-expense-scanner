import { notFound } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { forOrganization, type TenantClient } from '@/lib/db/tenant';
import { isPublicIdShape } from '@/lib/quotes/numbering';

/**
 * Resolving a public quote link.
 *
 * This is the one place in the product where a tenant is chosen by something a
 * stranger sent us, so it is worth being precise about why that is safe.
 *
 * The `publicId` is 128 bits of randomness and unique across the whole table.
 * Looking a quote up by it therefore *identifies* exactly one organization — it
 * does not let the caller choose one. The lookup runs on the unscoped client
 * (there is no session to scope by), and everything after it runs on a tenant
 * client pinned to whatever organization that quote turned out to belong to. A
 * caller cannot widen the scope, because they never supply the organization.
 *
 * The alternative — passing an organization id alongside the quote id — is the
 * design that goes wrong, and it is worth naming so nobody reintroduces it.
 */
export type PublicQuoteScope = {
  organizationId: string;
  quoteId: string;
  db: TenantClient;
};

export async function resolvePublicQuote(publicId: string): Promise<PublicQuoteScope> {
  // Shape-checked before it reaches Postgres: an id containing a NUL byte would
  // crash the query rather than simply miss, and this endpoint is reachable by
  // anyone with the URL.
  if (!isPublicIdShape(publicId)) throw notFound('That quote link is not valid.');

  const quote = await prisma.quote.findUnique({
    where: { publicId },
    select: { id: true, organizationId: true },
  });

  // One message for "no such quote" and for "wrong shape", so the endpoint
  // cannot be used to probe which ids exist.
  if (!quote) throw notFound('That quote link is not valid.');

  return {
    organizationId: quote.organizationId,
    quoteId: quote.id,
    db: forOrganization(quote.organizationId),
  };
}

/**
 * The business details a quote page is allowed to show.
 *
 * An explicit allow-list, not a `select: *` with a few fields removed. A public
 * page is the wrong place to discover that a column added next year was
 * sensitive — this way a new column is invisible until someone deliberately adds
 * it here.
 */
export async function publicOrganization(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      logoUrl: true,
      email: true,
      phone: true,
      website: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      currency: true,
      timezone: true,
    },
  });

  if (!organization) throw notFound('That quote link is not valid.');
  return organization;
}
