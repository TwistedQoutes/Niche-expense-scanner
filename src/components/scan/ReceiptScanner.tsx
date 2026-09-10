'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import { ExpenseForm, draftFromScan, emptyDraft, type ExpenseFormDraft } from '@/components/scan/ExpenseForm';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { ApiError, apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import {
  ACCEPTED_IMAGE_TYPES,
  ImageValidationError,
  preprocessReceiptImage,
  type PreprocessResult,
} from '@/lib/ocr/preprocess';
import { recogniseReceipt, terminateOcr, type OcrProgress } from '@/lib/ocr/client';
import type { ExpenseDto, ParseReceiptResponse } from '@/types';

type Step =
  | { name: 'choose' }
  | { name: 'working'; progress: OcrProgress }
  | { name: 'review'; scan: ParseReceiptResponse; rawText: string; draft: ExpenseFormDraft }
  | { name: 'manual'; draft: ExpenseFormDraft }
  | { name: 'saved'; expense: ExpenseDto };

const STAGE_COPY: Record<OcrProgress['stage'], string> = {
  idle: 'Getting ready…',
  'loading-engine': 'Loading the text recogniser (first scan only)…',
  recognising: 'Reading the receipt…',
  done: 'Almost there…',
  error: 'Something went wrong.',
};

/**
 * The scan flow: choose an image → OCR in the browser → parse on the server →
 * review → save.
 *
 * Two design decisions worth calling out:
 *
 * - There is always a manual path. OCR fails on faded thermal paper no matter
 *   how good the preprocessing is, and an expense tracker that can only be fed
 *   by camera is useless the moment that happens.
 * - The engine download is called out explicitly on first use, because ~15 MB
 *   of silent loading on studio wifi looks like a broken app.
 */
export function ReceiptScanner() {
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<PreprocessResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const releaseImage = useCallback(() => {
    imageRef.current?.revoke();
    imageRef.current = null;
    setPreviewUrl(null);
  }, []);

  // Free the object URLs and the OCR worker when the page is left.
  useEffect(() => {
    return () => {
      imageRef.current?.revoke();
      imageRef.current = null;
      void terminateOcr();
    };
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      releaseImage();
      setStep({ name: 'working', progress: { stage: 'idle', value: 0 } });

      try {
        const image = await preprocessReceiptImage(file);
        imageRef.current = image;
        setPreviewUrl(image.previewUrl);

        const { text, confidence } = await recogniseReceipt(image.url, (progress) => {
          setStep({ name: 'working', progress });
        });

        // Fewer than ~20 characters means we photographed a wall, not a receipt.
        if (text.trim().length < 20) {
          setError(
            confidence < 0.3
              ? "That image was too blurry to read. Try again in better light, or enter the expense by hand."
              : "Not much text was found on that image. Check it's a receipt, or enter the expense by hand.",
          );
          setStep({ name: 'choose' });
          return;
        }

        const scan = await apiRequest<ParseReceiptResponse>('/api/receipts/parse', {
          method: 'POST',
          body: { rawText: text },
        });

        setStep({ name: 'review', scan, rawText: text, draft: draftFromScan(scan) });
      } catch (caught) {
        if (caught instanceof ImageValidationError) {
          setError(caught.message);
        } else if (caught instanceof ApiError) {
          setError(caught.message);
        } else {
          console.error('[scan] failed', caught);
          setError(
            'The text recogniser could not start. Check your connection, or enter the expense by hand.',
          );
        }
        setStep({ name: 'choose' });
      } finally {
        // Let the same file be picked again after a failure.
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [releaseImage],
  );

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function reset() {
    releaseImage();
    setError(null);
    setStep({ name: 'choose' });
  }

  if (step.name === 'saved') {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Expense saved">
          {formatCents(step.expense.amountCents, step.expense.currency)} at {step.expense.merchant} —{' '}
          filed under {step.expense.category.toLowerCase().replace(/_/g, ' ')}.
        </Alert>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{step.expense.merchant}</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{step.expense.spentAt}</p>
            </div>
            <CategoryChip category={step.expense.category} />
          </div>
        </Card>

        <div className="flex gap-3">
          <Button size="lg" className="flex-1" onClick={reset}>
            Scan another
          </Button>
          <Link href="/dashboard" className="flex-1">
            <Button size="lg" variant="secondary" fullWidth>
              View expenses
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (step.name === 'review' || step.name === 'manual') {
    return (
      <div className="space-y-4">
        {previewUrl && step.name === 'review' ? (
          <Card className="overflow-hidden">
            {/* A plain <img>: the source is a local object URL, which the Next
                image optimiser cannot process. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="The receipt you scanned"
              className="max-h-56 w-full bg-zinc-100 object-contain dark:bg-zinc-800"
            />
          </Card>
        ) : null}

        <ExpenseForm
          initialDraft={step.draft}
          scan={step.name === 'review' ? step.scan : undefined}
          rawText={step.name === 'review' ? step.rawText : undefined}
          onSaved={(expense) => {
            releaseImage();
            setStep({ name: 'saved', expense });
          }}
          onCancel={reset}
        />
      </div>
    );
  }

  if (step.name === 'working') {
    const percent = Math.round(step.progress.value * 100);
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          {previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt=""
              className="max-h-40 w-full rounded-xl bg-zinc-100 object-contain dark:bg-zinc-800"
            />
          ) : null}

          <p className="text-sm font-medium">{STAGE_COPY[step.progress.stage]}</p>

          <div
            className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Scan progress"
          >
            <div
              className="bg-brand-600 h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.max(4, percent)}%` }}
            />
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Everything runs on your device — the photo is never uploaded.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-2xl border-2 border-dashed p-6 text-center transition-colors',
          dragging
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40'
            : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900',
        )}
      >
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-950/60">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            className="text-brand-600 dark:text-brand-400 size-6"
            aria-hidden="true"
          >
            <path d="M3 9a2 2 0 0 1 2-2h1.5l1-2h5l1 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
            <circle cx="12" cy="13" r="3.25" />
          </svg>
        </div>

        <h2 className="mt-3 font-semibold">Add a receipt</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Take a photo, or drop an image here.
        </p>

        <div className="mt-5 space-y-2">
          <Button size="lg" fullWidth onClick={() => fileInputRef.current?.click()}>
            Choose or take a photo
          </Button>
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            onClick={() => setStep({ name: 'manual', draft: emptyDraft() })}
          >
            Enter it manually
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          // `capture` opens the rear camera directly on a phone, while still
          // allowing a gallery pick on desktop.
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          capture="environment"
          onChange={onInputChange}
          className="sr-only"
          aria-label="Receipt image"
        />
      </div>

      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
        Best results: flat receipt, even light, no shadow across the total.
      </p>
    </div>
  );
}
