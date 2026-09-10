import { withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { requireUser } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * Everything we hold about this account, as one JSON file.
 *
 * Distinct from the CSV export, which is shaped for an accountant. This is the
 * data-portability obligation under GDPR Article 20 and the CCPA: machine
 * readable, complete, and including the fields an artist would not think to ask
 * for — when the account was made, what their categorisation was changed from,
 * whether an image is retained.
 *
 * Deliberately excluded: the password hash, and the raw bytes of receipt
 * images. The hash is a credential, not personal data worth handing back, and
 * the images are fetched individually from the URLs listed here rather than
 * inflating this file to hundreds of megabytes.
 */
export const GET = withRoute(async () => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.export, user.id);

  const [account, expenses] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        studioName: true,
        createdAt: true,
        updatedAt: true,
        emailVerifiedAt: true,
        storeReceiptImages: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        stripeCustomerId: true,
      },
    }),
    prisma.expense.findMany({
      where: { userId: user.id },
      include: { lines: { orderBy: { position: 'asc' } } },
      orderBy: { spentAt: 'asc' },
    }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    format: 'niche-expense-scanner/account-export@1',
    account,
    expenses: expenses.map((expense) => ({
      id: expense.id,
      merchant: expense.merchant,
      amountCents: expense.amountCents,
      taxCents: expense.taxCents,
      currency: expense.currency,
      spentAt: expense.spentAt.toISOString().slice(0, 10),
      notes: expense.notes,
      createdAt: expense.createdAt.toISOString(),
      // The OCR text is included: it is derived from the artist's own receipt
      // and is theirs.
      rawText: expense.rawText,
      receiptImage: expense.imageKey
        ? {
            retained: true,
            contentType: expense.imageMimeType,
            bytes: expense.imageBytes,
            downloadPath: `/api/expenses/${expense.id}/receipt`,
          }
        : { retained: false },
      lines: expense.lines.map((line) => ({
        label: line.label,
        amountCents: line.amountCents,
        category: line.category,
        categorisedBy: line.categorySource === 'manual' ? 'artist' : 'scanner',
        categoryConfidence: line.categoryConfidence,
      })),
    })),
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="niche-expense-scanner-export-${
        new Date().toISOString().slice(0, 10)
      }.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
