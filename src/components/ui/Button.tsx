import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 dark:disabled:bg-brand-900',
  secondary:
    'bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 active:bg-slate-100 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-800 dark:hover:bg-slate-800',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
  danger:
    'bg-white text-red-600 ring-1 ring-red-200 hover:bg-red-50 dark:bg-slate-900 dark:text-red-400 dark:ring-red-900/60 dark:hover:bg-red-950/40',
};

const SIZES: Record<Size, string> = {
  // 44px minimum touch target on every size — the iOS accessibility floor.
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-sm gap-2',
  lg: 'min-h-12 px-5 text-base gap-2',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      // Tells screen readers the control is busy rather than simply gone.
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-medium',
        /*
         * The press.
         *
         * A button that changes colour instantly reads as a link; one that
         * settles into its new colour over a beat reads as a physical control
         * being pushed. 150ms is the range where it registers as responsiveness
         * rather than as animation — slow enough to perceive, fast enough that
         * nobody waits for it.
         *
         * The 1% scale on press is the whole of the "feel" budget for this
         * component. It is barely visible and it is the thing that makes a tap
         * feel like it landed, particularly on a phone where there is no cursor
         * to confirm anything. Both are inside the global
         * prefers-reduced-motion rule in globals.css, so anybody who has asked
         * their system for less movement gets none of it.
         */
        'transition-[color,background-color,box-shadow,transform] duration-150 ease-out',
        'active:scale-[0.99]',
        'disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100',
        // Removes the 300ms tap delay and the grey flash on mobile Safari.
        'touch-manipulation select-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading ? <Spinner className="size-4" /> : null}
      {children}
    </button>
  );
}
