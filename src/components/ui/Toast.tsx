'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

/**
 * Transient feedback: "Quote sent", "Could not reach Twilio".
 *
 * Deliberately tiny — no portal, no animation library. What it does get right
 * is the accessibility contract, which is the part that is usually wrong:
 * errors are assertive so a screen reader interrupts, everything else is polite
 * and waits its turn, and an error stays on screen until dismissed rather than
 * disappearing before it can be read.
 */

export type ToastTone = 'success' | 'error' | 'info';

type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ToastContextValue = {
  toast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast must be used inside <ToastProvider>.');
  }
  return value;
}

const TONES: Record<ToastTone, string> = {
  success: 'bg-brand-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  // Timers are tracked so unmounting mid-toast does not leave one running
  // against a component that is gone.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current, { id, tone, message }]);

      // Errors persist. A failure the user never got to read is a support
      // ticket, and four seconds is not long enough to read a failure and
      // decide what to do about it.
      if (tone !== 'error') {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), 4000),
        );
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (message: string) => toast(message, 'success'),
      error: (message: string) => toast(message, 'error'),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 pb-[var(--spacing-safe-bottom)]"
        // The live region wraps the list rather than each toast, so a message
        // added later is announced without re-announcing the ones already there.
        aria-live="polite"
      >
        {toasts.map((entry) => (
          <div
            key={entry.id}
            role={entry.tone === 'error' ? 'alert' : 'status'}
            aria-live={entry.tone === 'error' ? 'assertive' : 'polite'}
            className={cn(
              'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg',
              TONES[entry.tone],
            )}
          >
            <span className="flex-1">{entry.message}</span>
            <button
              type="button"
              onClick={() => dismiss(entry.id)}
              className="shrink-0 rounded-md px-1 opacity-80 hover:opacity-100"
            >
              <span aria-hidden="true">×</span>
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
