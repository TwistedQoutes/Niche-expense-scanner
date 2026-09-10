import { ApiError } from '@/lib/api-client';

/**
 * Uploads a retained receipt image.
 *
 * Sent as multipart form data rather than JSON: base64 in a JSON body inflates
 * the payload by a third for no benefit, and `FormData` streams the bytes.
 *
 * Deliberately separate from saving the expense. The expense is the thing that
 * matters — if the image upload fails (offline, storage full, retention turned
 * off on another device) the artist should still have their expense recorded,
 * and be told the picture did not stick.
 */
export async function uploadReceiptImage(expenseId: string, image: Blob): Promise<void> {
  const form = new FormData();
  form.append('file', image, 'receipt.jpg');

  let response: Response;
  try {
    response = await fetch(`/api/expenses/${encodeURIComponent(expenseId)}/receipt`, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(
      0,
      'network_error',
      'The expense was saved, but the image could not be uploaded.',
    );
  }

  if (response.ok) return;

  const payload: unknown = await response.json().catch(() => null);
  const message =
    payload && typeof payload === 'object' && 'error' in payload
      ? ((payload as { error: { message?: string } }).error.message ??
        'The expense was saved, but the image could not be uploaded.')
      : 'The expense was saved, but the image could not be uploaded.';

  throw new ApiError(response.status, 'upload_failed', message);
}
