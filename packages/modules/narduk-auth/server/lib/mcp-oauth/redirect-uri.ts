const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])

/**
 * A redirect URI a client may register: https anywhere, or http on a loopback
 * address (RFC 8252 native apps). No fragments, no credentials, no custom
 * schemes. The library still requires an exact match at authorize and token.
 */
export function isAllowedMcpOAuthRedirectUri(value: unknown): boolean {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}
