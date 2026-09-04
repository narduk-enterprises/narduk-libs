const SAME_ORIGIN_BASE = 'https://app.local'

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }

  return false
}

/**
 * The single same-origin redirect-path guard for this package.
 *
 * Four independent copies of this check previously lived side by side in
 * narduk-auth (`app/utils/safeRedirectPath.ts`,
 * `server/lib/app-auth/helpers.ts`, `server/lib/app-auth/local-email-core.ts`
 * and `server/api/auth/session/exchange.get.ts`) and they did not agree: only
 * the client-side copy rejected a bare (non-`/`-prefixed) value or a
 * percent-encoded backslash, so the *advisory* client check was strictly
 * stronger than the *authoritative* server checks it was meant to mirror.
 *
 * This implementation is the union of the strictest rule from every copy, so
 * consolidating onto it can only narrow what is accepted, never widen it.
 *
 * Accepted: an absolute same-origin path such as `/q/atlas?mode=scan#results`.
 * Everything else resolves to `fallback`.
 *
 * `fallback` is returned verbatim and is NOT itself sanitized. Pass an
 * operator-configured or hardcoded path; never pass caller-controlled input as
 * the fallback, or this guard becomes a no-op for that call site.
 */
export function sanitizeSameOriginPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const path = value.trim()

  // Must be an absolute path. A bare value such as `foo` was previously
  // coerced into `/foo` by the server copies, silently promoting arbitrary
  // input to a redirect target.
  if (!path.startsWith('/')) return fallback

  // Protocol-relative (`//host`) and backslash-smuggled authorities. The URL
  // parse below rejects most of these today; the explicit checks keep the
  // guarantee from depending on parser normalization behaviour.
  if (path.startsWith('//')) return fallback
  if (path.includes('\\')) return fallback
  if (/%5c/iu.test(path)) return fallback

  // Raw control characters, which some parsers strip before resolving.
  if (hasControlCharacter(path)) return fallback

  // Malformed percent-encoding (`/%zz`, a trailing `/ok%`, a truncated
  // `/a%2`). `sanitizeLocalEmailRedirect` rejected these as a side effect of
  // decoding before its backslash check, and different layers disagree about
  // how to repair them, so keep rejecting rather than passing them on.
  // Decoding also catches a backslash smuggled past the literal checks above.
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return fallback
  }
  if (decoded.includes('\\')) return fallback

  // Belt and braces. Once the checks above pass, WHATWG URL resolution is
  // guaranteed to produce a same-origin, `/`-prefixed pathname and not to
  // throw, so neither branch below is currently reachable — 200k fuzz inputs
  // hit neither. They are kept so the guarantee survives an edit that relaxes
  // a check above; do not read their coverage gap as untested behaviour.
  try {
    const url = new URL(path, SAME_ORIGIN_BASE)
    if (url.origin !== SAME_ORIGIN_BASE || !url.pathname.startsWith('/')) {
      return fallback
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
