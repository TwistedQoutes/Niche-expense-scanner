import { createWorker, type Worker } from 'tesseract.js';

/**
 * Browser-side OCR.
 *
 * Running Tesseract in the browser rather than calling a cloud OCR API is a
 * product decision as much as a technical one:
 *
 *   - Receipt images can carry a client's name and a card's last four digits.
 *     Keeping them on the device means we never become a custodian of that.
 *   - No per-scan cost, so scanning stays unmetered on every plan.
 *   - No API key to leak, no vendor outage to take the feature down.
 *
 * The trade-off is a one-time ~15 MB engine download (cached by the browser
 * afterwards) and a few seconds per receipt on a mid-range phone — which is why
 * `recognise` reports progress rather than just spinning.
 */

const ENGINE_PATHS = {
  workerPath: '/ocr/worker.min.js',
  corePath: '/ocr/core',
  langPath: '/ocr/lang',
} as const;

export type OcrStage = 'idle' | 'loading-engine' | 'recognising' | 'done' | 'error';

export type OcrProgress = {
  stage: OcrStage;
  /** 0–1 within the current stage. */
  value: number;
};

/**
 * The worker is expensive to start, so it is created once and reused for every
 * receipt in the session.
 */
let workerPromise: Promise<Worker> | null = null;

async function getWorker(onProgress?: (progress: OcrProgress) => void): Promise<Worker> {
  if (workerPromise) return workerPromise;

  workerPromise = createWorker('eng', 1, {
    ...ENGINE_PATHS,
    logger: (message) => {
      if (!onProgress) return;
      // Tesseract emits many status strings; only two matter to a user.
      if (message.status === 'loading tesseract core' || message.status === 'loading language traineddata') {
        onProgress({ stage: 'loading-engine', value: message.progress });
      } else if (message.status === 'recognizing text') {
        onProgress({ stage: 'recognising', value: message.progress });
      }
    },
  }).catch((error: unknown) => {
    // Do not cache a failed start-up, or every later attempt inherits it.
    workerPromise = null;
    throw error;
  });

  return workerPromise;
}

export type OcrResult = {
  text: string;
  /** Tesseract's own 0–100 confidence in the recognition, normalised to 0–1. */
  confidence: number;
};

export async function recogniseReceipt(
  imageUrl: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrResult> {
  const worker = await getWorker(onProgress);

  onProgress?.({ stage: 'recognising', value: 0 });
  const { data } = await worker.recognize(imageUrl);
  onProgress?.({ stage: 'done', value: 1 });

  return {
    text: data.text ?? '',
    confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)),
  };
}

/** Releases the worker — called when the scanner unmounts. */
export async function terminateOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;

  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Nothing useful to do if teardown fails; the page is going away anyway.
  }
}
