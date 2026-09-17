const SAME_ORIGIN_BASE = 'https://app.local'

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }

  return false
}

/**
 * Same-origin path guard for canonical / `og:url` resolution.
 *
 * Rules match narduk-auth `sanitizeSameOriginPath` (this package must not
 * import that module). Accepted: an absolute same-origin path such as
 * `/q/atlas?mode=scan#results`. Everything else resolves to `fallback`.
 *
 * `fallback` is returned verbatim and is NOT itself sanitized. Pass a
 * hardcoded path; never pass caller-controlled input as the fallback.
 */
export function sanitizeSameOriginPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const path = value.trim()

  if (!path.startsWith('/')) return fallback

  if (path.startsWith('//')) return fallback
  if (path.includes('\\')) return fallback
  if (/%5c/iu.test(path)) return fallback

  if (hasControlCharacter(path)) return fallback

  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return fallback
  }
  if (decoded.includes('\\')) return fallback

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
