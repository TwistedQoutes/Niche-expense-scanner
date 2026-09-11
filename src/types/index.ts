import type { CategoryId } from '@/lib/categories/taxonomy';

/**
 * The wire shape of an expense.
 *
 * Deliberately distinct from the Prisma model: `Date` objects do not survive
 * JSON, and the client never needs `userId`. Serialising through one function
 * (`serialiseExpense`) keeps the two from drifting.
 */
export type ExpenseLineDto = {
  id: string;
  label: string | null;
  amountCents: number;
  category: CategoryId;
  categoryConfidence: number;
  categorySource: 'auto' | 'manual';
  position: number;
};

export type ExpenseDto = {
  id: string;
  merchant: string;
  amountCents: number;
  taxCents: number | null;
  currency: string;
  /** `YYYY-MM-DD`. */
  spentAt: string;
  notes: string | null;
  createdAt: string;
  /**
   * Always at least one. A single line means an unsplit receipt; more than one
   * means the receipt was split across categories, and `amountCents` is the sum.
   */
  lines: ExpenseLineDto[];
  /**
   * Whether a receipt image is retained. The image itself is fetched from
   * `/api/expenses/:id/receipt`, never inlined here — it is far too large to
   * belong in a list payload.
   */
  hasImage: boolean;
};

export type CurrencyTotal = {
  currency: string;
  totalCents: number;
  taxCents: number;
  count: number;
};

export type MonthSummary = {
  month: string;
  /**
   * The headline figures, in `currency` only.
   *
   * Money in different currencies does not add up, so these deliberately
   * describe a single currency rather than a meaningless cross-currency sum.
   * Anything the artist spent in another currency is in `byCurrency`.
   */
  totalCents: number;
  taxCents: number;
  count: number;
  byCategory: { category: CategoryId; totalCents: number; count: number }[];
  currency: string;
  /** Every currency used this month, largest first. Length > 1 means mixed. */
  byCurrency: CurrencyTotal[];
};

export type ExpenseListResponse = {
  expenses: ExpenseDto[];
  summary: MonthSummary;
  nextCursor: string | null;
};

export type ParseReceiptResponse = {
  merchant: { value: string | null; confidence: number };
  amountCents: { value: number | null; confidence: number };
  taxCents: { value: number | null; confidence: number };
  spentAt: { value: string | null; confidence: number };
  currency: string;
  category: {
    value: CategoryId;
    confidence: number;
    matchedTerms: string[];
    alternatives: { category: CategoryId; confidence: number }[];
  };
  /**
   * A proposed split, when the receipt itemises products across two or more
   * categories. Null when there is nothing worth suggesting — see
   * `suggestSplit` for why the bar is deliberately high.
   */
  suggestedLines:
    | { label: string; amountCents: number; category: CategoryId; categoryConfidence: number }[]
    | null;
  /** True when at least one field needs the artist's eyes before saving. */
  needsReview: boolean;
};

export type UserDto = {
  id: string;
  email: string;
  studioName: string | null;
  /** Whether this artist has opted into keeping receipt images. */
  storeReceiptImages: boolean;
};

/** What the client needs to know about this deployment's capabilities. */
export type CapabilitiesDto = {
  /** False when no storage driver is configured, which hides the option entirely. */
  receiptStorageAvailable: boolean;
  maxImageBytes: number;
};
