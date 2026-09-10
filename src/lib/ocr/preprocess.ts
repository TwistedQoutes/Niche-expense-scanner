/**
 * Client-side image preparation, run before OCR.
 *
 * A phone photo of a receipt is the worst case for Tesseract: 12 megapixels of
 * colour noise, uneven studio lighting, and a shadow down one side. Three cheap
 * canvas operations fix most of it and cut recognition time by more than half:
 *
 *   1. Downscale — beyond ~1600px on the long edge there is no extra character
 *      detail, only pixels to chew through.
 *   2. Greyscale — colour carries no information for text, and the luminance
 *      weights match how the eye (and Tesseract) see contrast.
 *   3. Contrast stretch — thermal paper prints grey-on-grey; pushing the
 *      histogram out to the ends sharpens the character edges.
 *
 * Everything here runs in the browser, so the original image never leaves the
 * device.
 */

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const MAX_EDGE = 1600;

export type PreprocessResult = {
  /** Object URL of the processed image, ready to hand to Tesseract. */
  url: string;
  /** Object URL of the untouched original, for the on-screen preview. */
  previewUrl: string;
  width: number;
  height: number;
  /** Frees both object URLs. Always call this when the scan is finished. */
  revoke: () => void;
};

export class ImageValidationError extends Error {}

export function validateImageFile(file: File): void {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageValidationError('That image is larger than 12 MB. Try a photo at a lower resolution.');
  }

  // Some Android browsers report an empty type for HEIC; fall back to the
  // extension rather than rejecting a valid photo.
  const looksLikeImage =
    file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);

  if (!looksLikeImage) {
    throw new ImageValidationError('That file is not an image. Upload a photo or screenshot of the receipt.');
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new ImageValidationError(
          "That image couldn't be opened. If it's a HEIC photo, try sharing it as JPEG.",
        ),
      );
    image.src = url;
  });
}

/** Blob → object URL, wrapped so callers never juggle the canvas API. */
function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not process that image.'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      // PNG keeps the sharpened edges crisp; JPEG artefacts would undo the
      // contrast work we just did.
      'image/png',
    );
  });
}

export async function preprocessReceiptImage(file: File): Promise<PreprocessResult> {
  validateImageFile(file);

  const previewUrl = URL.createObjectURL(file);

  let image: HTMLImageElement;
  try {
    image = await loadImage(previewUrl);
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    URL.revokeObjectURL(previewUrl);
    throw new Error('This browser cannot process images. Try entering the expense manually.');
  }

  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const pixels = context.getImageData(0, 0, width, height);
  const data = pixels.data;

  // Pass 1: greyscale, tracking the actual luminance range present.
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const grey = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
    data[i] = grey;
    data[i + 1] = grey;
    data[i + 2] = grey;
    if (grey < min) min = grey;
    if (grey > max) max = grey;
  }

  // Pass 2: stretch that range across the full 0–255 scale. Skipped when the
  // image is already full-range or (pathologically) flat.
  const range = max - min;
  if (range > 8 && range < 255) {
    const factor = 255 / range;
    for (let i = 0; i < data.length; i += 4) {
      const stretched = Math.min(255, Math.max(0, Math.round((data[i]! - min) * factor)));
      data[i] = stretched;
      data[i + 1] = stretched;
      data[i + 2] = stretched;
    }
  }

  context.putImageData(pixels, 0, 0);

  let url: string;
  try {
    url = await canvasToUrl(canvas);
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }

  return {
    url,
    previewUrl,
    width,
    height,
    revoke: () => {
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(previewUrl);
    },
  };
}

/** Longest edge of a retained image. Plenty to read a total from, far smaller than a raw photo. */
const ARCHIVE_MAX_EDGE = 2000;
const ARCHIVE_QUALITY = 0.85;

/**
 * Prepares the original photo for retention, when the artist has opted in.
 *
 * Two things happen here, and the first matters more than the second:
 *
 * 1. **EXIF is stripped.** Phone photos carry metadata, and on most phones that
 *    includes GPS coordinates — so an unmodified receipt photo records where
 *    the artist was when they took it. Re-encoding through a canvas drops all
 *    metadata as a side effect of how canvas works, which is exactly what we
 *    want: we are keeping a picture of a receipt, not a location history.
 * 2. It is downscaled and JPEG-compressed, because a 12-megapixel original is
 *    ~5 MB of storage per receipt to prove a $24.50 ink purchase.
 *
 * The *original* is used as the source rather than the OCR-preprocessed copy:
 * the greyscale, contrast-stretched version is tuned for a text recogniser and
 * would be a poor audit record.
 */
export async function prepareImageForStorage(file: File): Promise<Blob> {
  validateImageFile(file);

  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(sourceUrl);

    const scale = Math.min(1, ARCHIVE_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot process images.');

    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Could not prepare that image for storage.'));
        },
        'image/jpeg',
        ARCHIVE_QUALITY,
      );
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
