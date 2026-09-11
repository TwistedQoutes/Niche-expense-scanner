import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

import { AppError } from '@/lib/api/errors';

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
  };
};

/** Flatten a Zod error into `{ fieldName: firstMessage }` for inline form display. */
export function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'form';
    // Keep the first message per field: showing five variations of "required"
    // for one input is noise.
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, {
    ...init,
    headers: {
      // API payloads are per-user; never let a shared cache hold onto them.
      'Cache-Control': 'no-store',
      ...init?.headers,
    },
  });
}

export function jsonError(error: AppError): NextResponse<ApiErrorBody> {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (error.retryAfter !== undefined) {
    headers['Retry-After'] = String(error.retryAfter);
  }

  return NextResponse.json<ApiErrorBody>(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      },
    },
    { status: error.status, headers },
  );
}
