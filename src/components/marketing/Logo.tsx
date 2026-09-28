import { cn } from '@/lib/cn';

/**
 * The mark: a dot that becomes a tick.
 *
 * The lead, and the job it turns into — which is the whole product in two
 * strokes. Deliberately geometric and deliberately simple, because it has to
 * survive being 16 pixels wide in a browser tab and on a phone's home screen,
 * where anything with more than two ideas in it turns to mush. The same drawing
 * is the favicon (src/app/icon.svg), so the tab and the page agree.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-8', className)}>
      <rect width="32" height="32" rx="9" className="fill-brand-600" />
      <circle cx="9.25" cy="17" r="2.4" fill="#fff" />
      <path
        d="M14 17.25l3.4 3.4L24.25 12"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-50">
        JobFlow <span className="text-brand-600 dark:text-brand-400">AI</span>
      </span>
    </span>
  );
}
