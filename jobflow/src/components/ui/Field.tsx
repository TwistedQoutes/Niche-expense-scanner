'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const CONTROL_BASE =
  'w-full rounded-xl bg-white px-3.5 py-2.5 text-base text-slate-900 ring-1 ring-slate-200 transition ' +
  'placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500 ' +
  'dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-800 dark:placeholder:text-slate-500 dark:focus:ring-brand-400 ' +
  'dark:disabled:bg-slate-900/50';

const INVALID = 'ring-red-400 focus:ring-red-500 dark:ring-red-800';

type WrapperProps = {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
};

/**
 * One wrapper owns the label/hint/error structure for every control, so the
 * accessible wiring (`htmlFor`, `aria-describedby`, `aria-invalid`,
 * `role="alert"`) is correct once instead of per-form.
 */
function FieldWrapper({ label, hint, error, children }: WrapperProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
};

export function TextField({ label, hint, error, className, ...props }: TextFieldProps) {
  return (
    <FieldWrapper label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <input
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(CONTROL_BASE, invalid && INVALID, className)}
        />
      )}
    </FieldWrapper>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
};

export function SelectField({ label, hint, error, className, children, ...props }: SelectFieldProps) {
  return (
    <FieldWrapper label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(CONTROL_BASE, 'appearance-none pr-9', invalid && INVALID, className)}
        >
          {children}
        </select>
      )}
    </FieldWrapper>
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'> & {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
};

export function TextAreaField({ label, hint, error, className, ...props }: TextAreaFieldProps) {
  return (
    <FieldWrapper label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <textarea
          {...props}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(CONTROL_BASE, 'min-h-20 resize-y', invalid && INVALID, className)}
        />
      )}
    </FieldWrapper>
  );
}
