/**
 * Where a visitor may be sent after signing in.
 *
 * The proxy puts the page someone was trying to reach into `?next=` so that
 * signing in returns them to it instead of dumping everyone on the dashboard
 * (see `redirectForFailure`). That parameter is attacker-controlled, and it ends
 * up in `router.replace()`, so it is an open redirect unless something proves it
 * points back at this site.
 *
 * The obvious check is the wrong one. This began as
 *
 *     next.startsWith('/') && !next.startsWith('//')
 *
 * which reads as "a path, not a protocol-relative URL" and is wrong, because a
 * URL parser treats a backslash as a slash for http(s) — so `/\evil.com`
 * satisfies both halves and still resolves to `https://evil.com/`. Verified in a
 * browser against the real login page: the victim authenticated on this domain
 * and landed on the attacker's. That is the whole phishing primitive — the link
 * in the mail *is* ours, the address bar during the password entry *is* ours, and
 * the clone asking them to "sign in again" arrives afterwards wearing our name.
 *
 * Which is the argument for not pattern-matching at all. Guessing which byte
 * sequences a parser will treat as a host is a losing game played against every
 * future URL spec change, so hand it to the parser and ask what it decided: if
 * resolving the value against an origin we chose lands anywhere but that origin,
 * it is not an internal path.
 */

/**
 * A base that cannot be reached, so escaping it is unambiguous. `.invalid` is
 * reserved by RFC 2606 and can never be registered.
 */
const SENTINEL_ORIGIN = 'https://internal.invalid';

/**
 * Returns `value` if it is a path within this site, otherwise `undefined`.
 *
 * Callers treat `undefined` as "use the default landing page", so a hostile
 * value degrades to an ordinary sign-in rather than an error the visitor has to
 * understand.
 */
export function safeReturnPath(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  // A relative reference cannot introduce a host, and a path is what the proxy
  // writes. Anything absolute is rejected before parsing, including the
  // scheme-relative `//host` form, which would otherwise resolve "successfully".
  if (!value.startsWith('/')) return undefined;

  let url: URL;
  try {
    url = new URL(value, SENTINEL_ORIGIN);
  } catch {
    return undefined;
  }

  // The parser's verdict, not ours. `/\evil.com`, `//evil.com` and
  // `/\/\evil.com` all change the origin here; a genuine path never does.
  if (url.origin !== SENTINEL_ORIGIN) return undefined;

  // Credentials cannot survive the origin check above, but a fragment can, and
  // there is no reason to carry one into a server-side navigation.
  return `${url.pathname}${url.search}`;
}
