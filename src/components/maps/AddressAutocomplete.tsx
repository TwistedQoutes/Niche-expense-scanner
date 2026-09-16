'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { TextField } from '@/components/ui/Field';
import { apiRequest } from '@/lib/api-client';

export type ResolvedAddress = {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string;
};

type Suggestion = { placeId: string; description: string; main: string; secondary: string };

export type AddressAutocompleteProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Fired when a suggestion is chosen and resolved into structured fields. */
  onResolved: (address: ResolvedAddress) => void;
  /** False when the deployment has no Maps key: renders as a plain text field. */
  enabled: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
};

/** 350ms: past the end of a typed word, short of feeling laggy. */
const DEBOUNCE_MS = 350;

/**
 * A session token per address being entered.
 *
 * Google bills autocomplete per request unless every keystroke and the final
 * resolve share one, in which case the session is billed once. `randomUUID` is
 * available in every browser this app supports; the fallback is for the older
 * ones where it is only exposed on secure origins.
 */
function newSessionToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * An address field that suggests as you type.
 *
 * Built as a real combobox rather than a div with a click handler: this is the
 * field somebody fills in on a phone, one-handed, in a truck. That means the
 * listbox is reachable by keyboard, the active option is announced, Escape closes
 * without clearing, and the whole thing degrades to an ordinary text input when
 * the deployment has no Maps key — same component, same props, no branch at the
 * call site.
 *
 * Suggestions come from our own API, never from a Google script in the page. See
 * src/app/api/maps/autocomplete/route.ts for why.
 */
export function AddressAutocomplete(props: AddressAutocompleteProps) {
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [resolving, setResolving] = useState(false);

  const session = useRef(newSessionToken());
  const wrapper = useRef<HTMLDivElement>(null);
  /*
   * Only a keystroke asks for suggestions.
   *
   * The value is controlled by the form, and the form writes to it for reasons
   * that are not typing: a prefilled address when the page loads, and the tidied
   * line this component itself hands back after a pick. Keying the effect off the
   * value alone would treat both as a query — the second of them reopening the
   * list to show the address just chosen, and charging for it.
   */
  const typed = useRef(false);

  useEffect(() => {
    if (!props.enabled || !typed.current) return;

    // Below three characters there is nothing worth asking about; the list was
    // already closed by the keystroke that got us here.
    const query = props.value.trim();
    if (query.length < 3) return;

    // Debounced, and cancelled on the next keystroke: each call is a billed
    // request, and firing one per character is how a form becomes an invoice.
    const timer = setTimeout(async () => {
      try {
        const result = await apiRequest<{ suggestions: Suggestion[] }>('/api/maps/autocomplete', {
          method: 'POST',
          body: { kind: 'suggest', input: query, sessionToken: session.current },
        });

        setSuggestions(result.suggestions);
        setOpen(result.suggestions.length > 0);
        setActive(-1);
      } catch {
        // Rate limited, not configured, offline — all the same to someone
        // typing: no suggestions, and the field still works.
        setSuggestions([]);
        setOpen(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [props.value, props.enabled]);

  // Clicking away closes the list without disturbing what was typed.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  async function choose(suggestion: Suggestion) {
    typed.current = false;
    props.onChange(suggestion.main);
    setOpen(false);
    setSuggestions([]);
    setResolving(true);

    try {
      const result = await apiRequest<{ place: ResolvedAddress | null }>(
        '/api/maps/autocomplete',
        {
          method: 'POST',
          body: { kind: 'resolve', placeId: suggestion.placeId, sessionToken: session.current },
        },
      );

      if (result.place) {
        props.onResolved(result.place);
        // The session ended with that resolve. The next address starts a new one,
        // or Google bills the next lookup against a spent token.
        session.current = newSessionToken();
      }
    } catch {
      // The line they picked is already in the field; the rest stays as typed.
    } finally {
      setResolving(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      // Only when an option is highlighted, so Enter still submits the form for
      // somebody typing an address the list does not have.
      event.preventDefault();
      void choose(suggestions[active]!);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div ref={wrapper} className="relative">
      <TextField
        label={props.label}
        value={props.value}
        onChange={(event) => {
          typed.current = true;
          // Deleting back below the floor closes the list here rather than in the
          // effect: it happens on the keystroke, not 350ms after it, and the
          // stale suggestions never get a frame to be clicked in.
          if (event.target.value.trim().length < 3) {
            setSuggestions([]);
            setOpen(false);
            setActive(-1);
          }
          props.onChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        error={props.error}
        hint={resolving ? 'Looking that up…' : props.hint}
        placeholder={props.placeholder}
        required={props.required}
        disabled={props.disabled}
        autoComplete={props.enabled ? 'off' : 'address-line1'}
        role={props.enabled ? 'combobox' : undefined}
        aria-expanded={props.enabled ? open : undefined}
        aria-controls={props.enabled ? listId : undefined}
        aria-autocomplete={props.enabled ? 'list' : undefined}
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
      />

      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.placeId}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              // Mouse down rather than click: the input blurs on click, and the
              // blur handler would close the list before the click landed.
              onMouseDown={(event) => {
                event.preventDefault();
                void choose(suggestion);
              }}
              /*
               * Hover is a CSS state, not a React one. Highlighting on
               * `onMouseEnter` would mean the keyboard position could be moved by
               * something that is not the keyboard — and on a touch device it
               * silently is: the list opens under the finger that just tapped the
               * field, the browser synthesises a hover for whatever is now beneath
               * it, and the first arrow press then starts from the second option.
               */
              className={`cursor-pointer px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
                index === active ? 'bg-slate-100 dark:bg-slate-800' : 'bg-transparent'
              }`}
            >
              <span className="block font-medium text-slate-900 dark:text-slate-100">
                {suggestion.main}
              </span>
              {suggestion.secondary ? (
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {suggestion.secondary}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
