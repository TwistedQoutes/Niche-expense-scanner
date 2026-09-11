/**
 * Typed fetch wrapper for the browser.
 *
 * Every API failure arrives as an `ApiError` carrying the server's own message
 * and per-field errors, so a form can show "An account with that email already
 * exists" next to the email input without each component re-deriving what a
 * 409 means.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, code: string, message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Cookies carry the session; without this the request is anonymous.
      credentials: 'same-origin',
    });
  } catch (error) {
    // An aborted request is a caller decision, not a failure to report.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', 'No connection. Check your network and try again.');
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { code?: string; message?: string; fieldErrors?: Record<string, string> } }).error
        : null;

    throw new ApiError(
      response.status,
      error?.code ?? 'unknown_error',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.fieldErrors ?? {},
    );
  }

  return payload as T;
}
