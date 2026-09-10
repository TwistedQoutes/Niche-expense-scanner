'use client';

import { useState, type FormEvent } from 'react';

import {
  SplitEditor,
  draftLinesTotal,
  newDraftLine,
  type DraftLine,
} from '@/components/scan/SplitEditor';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { ConfidenceBadge } from '@/components/ui/ConfidenceBadge';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { ApiError, apiRequest } from '@/lib/api-client';
import { CATEGORY_LIST, categoryOf, type CategoryId } from '@/lib/categories/taxonomy';
import { toDateInputValue } from '@/lib/dates';
import { formatCents, parseAmountToCents } from '@/lib/money';
import type { ExpenseDto, ParseReceiptResponse } from '@/types';

export type ExpenseFormDraft = {
  merchant: string;
  /** Held as the string the user typed, converted to cents only on submit. */
  amount: string;
  tax: string;
  spentAt: string;
  category: CategoryId;
  currency: string;
  notes: string;
  /**
   * Empty while the receipt is a single category. Populated the moment it is
   * split, at which point these become the source of truth for categorisation
   * and `category` above is ignored.
   */
  lines: DraftLine[];
};

/** Builds a draft from a scan result, falling back to sensible blanks. */
export function draftFromScan(scan: ParseReceiptResponse): ExpenseFormDraft {
  return {
    merchant: scan.merchant.value ?? '',
    amount: scan.amountCents.value === null ? '' : (scan.amountCents.value / 100).toFixed(2),
    tax: scan.taxCents.value === null ? '' : (scan.taxCents.value / 100).toFixed(2),
    spentAt: scan.spentAt.value ?? toDateInputValue(new Date()),
    category: scan.category.value,
    currency: scan.currency,
    notes: '',
    // A suggested split is offered, not applied: the artist opts in, so a wrong
    // suggestion is one ignored banner rather than something to unpick.
    lines: [],
  };
}

export function emptyDraft(): ExpenseFormDraft {
  return {
    merchant: '',
    amount: '',
    tax: '',
    spentAt: toDateInputValue(new Date()),
    category: 'OTHER',
    currency: 'USD',
    notes: '',
    lines: [],
  };
}

/**
 * The review-and-save step.
 *
 * Scanning is never trusted blindly: the artist always sees the extracted
 * values in editable fields, with a confidence badge on the ones the parser was
 * unsure of. Correcting a field takes one tap, and correcting the *category*
 * flips it to `manual` so the app stops second-guessing it.
 */
export function ExpenseForm({
  initialDraft,
  scan,
  rawText,
  onSaved,
  onCancel,
}: {
  initialDraft: ExpenseFormDraft;
  scan?: ParseReceiptResponse;
  rawText?: string;
  onSaved: (expense: ExpenseDto) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<ExpenseFormDraft>(initialDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Tracks whether the artist changed the category away from the scanner's pick.
  const [categoryTouched, setCategoryTouched] = useState(false);
  // True while the lines are still exactly what the scanner proposed, so they
  // are reported as an automatic categorisation rather than the artist's own.
  const [splitFromSuggestion, setSplitFromSuggestion] = useState(false);

  const suggestion = scan?.suggestedLines ?? null;
  const isSplit = draft.lines.length > 0;

  function setLines(lines: DraftLine[]) {
    setDraft((current) => ({ ...current, lines }));
    setFieldErrors((current) => {
      if (!('lines' in current)) return current;
      const next = { ...current };
      delete next.lines;
      return next;
    });
  }

  /** Applies the scanner's proposed split verbatim. */
  function acceptSuggestion() {
    if (!suggestion) return;
    setLines(
      suggestion.map((line) =>
        newDraftLine(line.category, (line.amountCents / 100).toFixed(2), line.label),
      ),
    );
    setSplitFromSuggestion(true);
  }

  /** Starts a manual split, seeded with the current single category. */
  function startSplit() {
    const amountCents = parseAmountToCents(draft.amount);
    setLines([
      newDraftLine(draft.category, amountCents === null ? '' : (amountCents / 100).toFixed(2)),
      newDraftLine('OTHER'),
    ]);
    setSplitFromSuggestion(false);
  }

  function stopSplit() {
    setLines([]);
    setSplitFromSuggestion(false);
  }

  function update<K extends keyof ExpenseFormDraft>(key: K, value: ExpenseFormDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};

    if (draft.merchant.trim().length === 0) errors.merchant = 'Who was this paid to?';

    const amountCents = parseAmountToCents(draft.amount);
    if (draft.amount.trim().length === 0) {
      errors.amount = 'Enter the total.';
    } else if (amountCents === null) {
      errors.amount = 'Use a number like 45.99.';
    } else if (amountCents <= 0) {
      errors.amount = 'The total must be more than zero.';
    }

    if (draft.tax.trim().length > 0 && parseAmountToCents(draft.tax) === null) {
      errors.tax = 'Use a number like 3.60.';
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.spentAt)) errors.spentAt = 'Pick the date on the receipt.';

    // The split has to account for the whole receipt. Checked here as well as
    // on the server so the artist is told before the round trip, not after.
    if (draft.lines.length > 0 && amountCents !== null) {
      const allocated = draftLinesTotal(draft.lines);
      if (allocated !== amountCents) {
        const difference = amountCents - allocated;
        errors.lines =
          difference > 0
            ? `The parts are ${(difference / 100).toFixed(2)} short of the total.`
            : `The parts exceed the total by ${(-difference / 100).toFixed(2)}.`;
      } else if (draft.lines.some((line) => (parseAmountToCents(line.amount) ?? 0) <= 0)) {
        errors.lines = 'Every part needs an amount greater than zero.';
      }
    }

    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setFormError(null);

    const amountCents = parseAmountToCents(draft.amount);
    const taxCents = draft.tax.trim().length > 0 ? parseAmountToCents(draft.tax) : null;

    // A single-category receipt is still sent as one line, so the server and the
    // database only ever deal with one shape.
    const lines =
      draft.lines.length > 0
        ? draft.lines.map((line) => ({
            label: line.label.trim().length > 0 ? line.label.trim() : null,
            amountCents: parseAmountToCents(line.amount),
            category: line.category,
            categoryConfidence: splitFromSuggestion ? (scan?.category.confidence ?? 0) : 1,
            categorySource: splitFromSuggestion ? ('auto' as const) : ('manual' as const),
          }))
        : [
            {
              label: null,
              amountCents,
              category: draft.category,
              // A hand-picked category is certain by definition.
              categoryConfidence: categoryTouched ? 1 : (scan?.category.confidence ?? 0),
              categorySource: categoryTouched ? ('manual' as const) : ('auto' as const),
            },
          ];

    try {
      const { expense } = await apiRequest<{ expense: ExpenseDto }>('/api/expenses', {
        method: 'POST',
        body: {
          merchant: draft.merchant.trim(),
          amountCents,
          taxCents,
          currency: draft.currency,
          spentAt: draft.spentAt,
          notes: draft.notes.trim().length > 0 ? draft.notes.trim() : null,
          rawText: rawText ?? null,
          lines,
        },
      });

      onSaved(expense);
    } catch (error) {
      if (error instanceof ApiError) {
        // Server field names differ from form field names in two places.
        const mapped: Record<string, string> = { ...error.fieldErrors };
        if (mapped.amountCents) mapped.amount = mapped.amountCents;
        if (mapped.taxCents) mapped.tax = mapped.taxCents;

        setFieldErrors(mapped);
        if (Object.keys(mapped).length === 0) setFormError(error.message);
      } else {
        setFormError('Could not save that expense. Please try again.');
      }
      setSaving(false);
    }
  }

  const alternatives = (scan?.category.alternatives ?? []).filter(
    (alternative) => alternative.category !== draft.category,
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      {scan?.needsReview ? (
        <Alert tone="warning" title="Check these before saving">
          The scan wasn&rsquo;t certain about everything. Anything marked below is worth a glance.
        </Alert>
      ) : null}

      <div className="space-y-1">
        <TextField
          label="Paid to"
          value={draft.merchant}
          onChange={(event) => update('merchant', event.target.value)}
          error={fieldErrors.merchant}
          required
          autoCapitalize="words"
          placeholder="Kingpin Tattoo Supply"
        />
        {scan && scan.merchant.confidence < 0.6 ? (
          <ConfidenceBadge confidence={scan.merchant.confidence} missing={scan.merchant.value === null} />
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <TextField
            label="Total"
            value={draft.amount}
            onChange={(event) => update('amount', event.target.value)}
            error={fieldErrors.amount}
            required
            inputMode="decimal"
            // `decimal` rather than `numeric`: it gives iOS a decimal point.
            placeholder="0.00"
            className="tabular"
          />
          {scan && scan.amountCents.confidence < 0.6 ? (
            <ConfidenceBadge
              confidence={scan.amountCents.confidence}
              missing={scan.amountCents.value === null}
            />
          ) : null}
        </div>

        <TextField
          label="Tax"
          value={draft.tax}
          onChange={(event) => update('tax', event.target.value)}
          error={fieldErrors.tax}
          inputMode="decimal"
          placeholder="Optional"
          className="tabular"
        />
      </div>

      <div className="space-y-1">
        <TextField
          label="Date on receipt"
          type="date"
          value={draft.spentAt}
          onChange={(event) => update('spentAt', event.target.value)}
          error={fieldErrors.spentAt}
          required
          max={toDateInputValue(new Date())}
        />
        {scan && scan.spentAt.confidence < 0.6 ? (
          // A date the parser could not read falls back to today, which is a
          // silent way to file an expense in the wrong month — so say so.
          <ConfidenceBadge confidence={scan.spentAt.confidence} missing={scan.spentAt.value === null} />
        ) : null}
      </div>

      {/* A receipt that spans categories is offered as a split before the
          single-category picker, because accepting it makes that picker
          irrelevant. */}
      {suggestion && !isSplit ? (
        <Alert tone="info" title="This receipt looks like more than one category">
          <ul className="mt-1 space-y-0.5">
            {suggestion.map((line) => (
              <li key={line.category} className="flex justify-between gap-3 text-sm">
                <span className="truncate">{categoryOf(line.category).label}</span>
                <span className="tabular shrink-0 font-medium">
                  {formatCents(line.amountCents, draft.currency)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2.5">
            <Button type="button" size="sm" onClick={acceptSuggestion}>
              Split it this way
            </Button>
          </div>
        </Alert>
      ) : null}

      {isSplit ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Split across categories
            </span>
            <button
              type="button"
              onClick={stopSplit}
              className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
            >
              Use one category instead
            </button>
          </div>

          <SplitEditor
            lines={draft.lines}
            totalCents={parseAmountToCents(draft.amount)}
            currency={draft.currency}
            error={fieldErrors.lines}
            onChange={(lines) => {
              setLines(lines);
              setSplitFromSuggestion(false);
            }}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <SelectField
            label="Category"
            value={draft.category}
            onChange={(event) => {
              update('category', event.target.value as CategoryId);
              setCategoryTouched(true);
            }}
            hint={categoryOf(draft.category).hint}
          >
            {CATEGORY_LIST.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </SelectField>

          {scan && !categoryTouched && scan.category.matchedTerms.length > 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Matched{' '}
              {scan.category.matchedTerms.slice(0, 3).map((term, index) => (
                <span key={term}>
                  {index > 0 ? ', ' : ''}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">“{term}”</span>
                </span>
              ))}{' '}
              on the receipt.
            </p>
          ) : null}

          {alternatives.length > 0 && !categoryTouched ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Or:</span>
              {alternatives.map((alternative) => (
                <button
                  key={alternative.category}
                  type="button"
                  onClick={() => {
                    update('category', alternative.category);
                    setCategoryTouched(true);
                  }}
                  className="rounded-full transition hover:opacity-80"
                >
                  <CategoryChip category={alternative.category} />
                </button>
              ))}
            </div>
          ) : null}

          {!suggestion ? (
            <button
              type="button"
              onClick={startSplit}
              className="text-brand-600 dark:text-brand-400 text-xs font-medium hover:underline"
            >
              Split this receipt across categories
            </button>
          ) : null}
        </div>
      )}

      <TextAreaField
        label="Notes"
        value={draft.notes}
        onChange={(event) => update('notes', event.target.value)}
        error={fieldErrors.notes}
        maxLength={500}
        placeholder="Optional — what this was for"
        rows={2}
      />

      <div className="flex gap-3 pt-1">
        {onCancel ? (
          <Button type="button" variant="secondary" size="lg" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="lg" loading={saving} className="flex-1">
          {saving ? 'Saving…' : 'Save expense'}
        </Button>
      </div>
    </form>
  );
}
