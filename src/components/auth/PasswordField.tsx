'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type' | 'className'> & {
  label: string;
  hint?: string;
  error?: string;
};

/**
 * A password input with a show/hide button.
 *
 * For the person this is built for, it is not decoration: they are signing in
 * on a phone, in a truck, with a thumb, and a password they cannot see is a
 * password they type twice. The button is a real button — reachable by
 * keyboard, announced with its state — and it sits inside the field's ring so
 * it reads as part of the control.
 *
 * The wiring (label, hint, error, aria-describedby) matches TextField's, so a
 * screen reader meets the same structure on every field of the form.
 */
export function PasswordField({ label, hint, error, ...props }: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>

      <div
        className={cn(
          'flex items-center rounded-xl bg-white ring-1 ring-slate-200 transition focus-within:ring-2 focus-within:ring-brand-500',
          'dark:bg-slate-900 dark:ring-slate-800 dark:focus-within:ring-brand-400',
          error && 'ring-red-400 focus-within:ring-red-500 dark:ring-red-800',
        )}
      >
        <input
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          // The ring is on the wrapper, so the input itself draws none.
          className="min-w-0 flex-1 rounded-xl bg-transparent px-3.5 py-2.5 text-base text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
          className="mr-1 grid size-10 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:text-slate-700 focus-visible:text-slate-700 dark:hover:text-slate-200"
        >
          {visible ? (
            <EyeOff className="size-4.5" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Eye className="size-4.5" strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      </div>

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
