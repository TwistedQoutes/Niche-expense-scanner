import { validationFailed } from '@/lib/api/errors';
import { readJsonBody, withRoute } from '@/lib/api/handler';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/api/rate-limit';
import { jsonOk, toFieldErrors } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { MIN_CONFIDENCE, classifyExpense } from '@/lib/categories/classify';
import { parseReceiptText } from '@/lib/ocr/parse-receipt';
import { parseReceiptSchema } from '@/lib/validation';
import type { ParseReceiptResponse } from '@/types';

export const runtime = 'nodejs';

/**
 * Turns OCR text into a pre-filled expense.
 *
 * The image itself never leaves the browser — Tesseract runs client-side and
 * only the recognised *text* is posted here. That keeps a receipt (which can
 * carry a client's name or a card's last four digits) off our disks entirely,
 * and keeps the endpoint cheap: no image handling, no storage, no egress.
 *
 * Parsing and categorising happen on the server so the rules can be fixed
 * centrally, and so the same logic can later be reused for emailed receipts.
 */
export const POST = withRoute(async (request) => {
  const user = await requireUser();
  enforceRateLimit(RATE_LIMITS.parse, user.id);

  const parsed = parseReceiptSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw validationFailed(toFieldErrors(parsed.error));

  const { rawText } = parsed.data;

  const fields = parseReceiptText(rawText);
  const category = classifyExpense({ merchant: fields.merchant.value, rawText });

  const needsReview =
    fields.amountCents.value === null ||
    fields.amountCents.confidence < 0.6 ||
    fields.spentAt.value === null ||
    fields.spentAt.confidence < 0.6 ||
    fields.merchant.value === null ||
    category.confidence < MIN_CONFIDENCE;

  return jsonOk<ParseReceiptResponse>({
    merchant: fields.merchant,
    amountCents: fields.amountCents,
    taxCents: fields.taxCents,
    spentAt: fields.spentAt,
    currency: fields.currency,
    category: {
      value: category.category,
      confidence: category.confidence,
      matchedTerms: category.matchedTerms,
      alternatives: category.alternatives,
    },
    needsReview,
  });
});
