import { ZodError } from 'zod';

import { AppError } from '@/lib/api/errors';
import { jsonError, toFieldErrors } from '@/lib/api/response';

/**
 * Wraps a route handler so no unhandled rejection ever escapes as an opaque
 * Next.js 500 page.
 *
 *   export const POST = withRoute(async (request) => { ... });
 *
 * - `AppError`   → its own status and message (safe to show the user).
 * - `ZodError`   → 422 with per-field messages (a validation slip that got past
 *                  an explicit `safeParse`).
 * - anything else → logged with a correlation id, returned as a generic 500.
 */
export function withRoute<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      if (error instanceof AppError) {
        return jsonError(error);
      }

      if (error instanceof ZodError) {
        return jsonError(
          new AppError('validation_failed', 'Please check the highlighted fields.', {
            fieldErrors: toFieldErrors(error),
          }),
        );
      }

      // Unexpected: the client gets nothing useful, the logs get everything.
      const incidentId = crypto.randomUUID();
      console.error(`[api] unhandled error ${incidentId}`, {
        method: request.method,
        url: new URL(request.url).pathname,
        error,
      });

      return jsonError(
        new AppError(
          'internal_error',
          `Something went wrong on our end. Reference: ${incidentId}`,
        ),
      );
    }
  };
}

/** Parse a JSON body, rejecting oversized or malformed payloads explicitly. */
export async function readJsonBody(request: Request, maxBytes = 512 * 1024): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new AppError('unsupported_media_type', 'Expected a JSON request body.');
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AppError('payload_too_large', 'That request is too large.');
  }

  const text = await request.text();
  // content-length can lie (or be absent under chunked encoding), so the real
  // byte count is checked too.
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new AppError('payload_too_large', 'That request is too large.');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('bad_request', 'Request body was not valid JSON.');
  }
}
