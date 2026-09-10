/**
 * Application-level errors that map cleanly onto HTTP status codes.
 *
 * Route handlers throw these; `withRoute` (see ./handler.ts) turns them into
 * JSON responses. Anything that is *not* an AppError is treated as an
 * unexpected failure: logged server-side, reported to the client as a generic
 * 500 so internal details never leak.
 */
export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'internal_error';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Field-level messages, keyed by form field name, for inline display. */
  readonly fieldErrors?: Record<string, string>;
  /** Seconds the client should wait before retrying (429 responses). */
  readonly retryAfter?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: { fieldErrors?: Record<string, string>; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fieldErrors = options.fieldErrors;
    this.retryAfter = options.retryAfter;
  }
}

export const badRequest = (message = 'Malformed request.') => new AppError('bad_request', message);

export const unauthorized = (message = 'You need to sign in to do that.') =>
  new AppError('unauthorized', message);

export const notFound = (message = 'Not found.') => new AppError('not_found', message);

export const conflict = (message: string, fieldErrors?: Record<string, string>) =>
  new AppError('conflict', message, { fieldErrors });

export const validationFailed = (fieldErrors: Record<string, string>, message = 'Please check the highlighted fields.') =>
  new AppError('validation_failed', message, { fieldErrors });

export const rateLimited = (retryAfter: number) =>
  new AppError('rate_limited', 'Too many attempts. Please wait a moment and try again.', {
    retryAfter,
  });
