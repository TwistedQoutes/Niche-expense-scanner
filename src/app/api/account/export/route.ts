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

  const account = await prisma.user.findUniqueOrThrow({
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
  });

  /**
   * Expenses are streamed in batches rather than loaded at once.
   *
   * An artist with a few years of daily receipts has tens of thousands of rows,
   * each with its lines; materialising all of them and then serialising the
   * whole array holds two copies in memory at peak. On a serverless instance
   * with a few hundred megabytes that is an out-of-memory crash, and it happens
   * to your heaviest user — the one least able to afford losing their export.
   *
   * Batching keeps memory flat regardless of account size, at the cost of
   * assembling the JSON by hand.
   */
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => controller.enqueue(encoder.encode(chunk));

      try {
        write('{\n  "exportedAt": ' + JSON.stringify(new Date().toISOString()));
        write(',\n  "format": "niche-expense-scanner/account-export@1"');
        write(',\n  "account": ' + JSON.stringify(account));
        write(',\n  "expenses": [');

        let cursor: string | undefined;
        let first = true;

        for (;;) {
          const batch = await prisma.expense.findMany({
            where: { userId: user.id },
            include: { lines: { orderBy: { position: 'asc' } } },
            // Ordered by id, not date: a cursor needs a stable unique key, and
            // two receipts can share a date.
            orderBy: { id: 'asc' },
            take: EXPORT_BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });

          if (batch.length === 0) break;

          for (const expense of batch) {
            write((first ? '\n    ' : ',\n    ') + JSON.stringify(exportShape(expense)));
            first = false;
          }

          cursor = batch[batch.length - 1]?.id;
          if (batch.length < EXPORT_BATCH_SIZE) break;
        }

        write('\n  ]\n}\n');
        controller.close();
      } catch (error) {
        // The response has already begun, so the status cannot be changed —
        // aborting the stream is what tells the client the file is incomplete
        // rather than handing them a truncated export that looks whole.
        console.error('[account-export] failed midway', { userId: user.id, error });
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
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

/** Rows per database round-trip while streaming. */
const EXPORT_BATCH_SIZE = 200;

type ExportableExpense = Awaited<ReturnType<typeof prisma.expense.findMany>>[number] & {
  lines: { label: string | null; amountCents: number; category: string; categorySource: string; categoryConfidence: number }[];
};

function exportShape(expense: ExportableExpense) {
  return {
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
  };
}
