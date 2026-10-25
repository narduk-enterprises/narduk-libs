/**
 * Whether `requestUrl` resolves to `currentOrigin`. Resolving (rather than
 * testing for a leading `/`) keeps `//evil.example/x` and `/\evil.example` from
 * counting as same-origin.
 */
export function isSameOriginRequest(
  requestUrl: string | undefined,
  currentOrigin: string,
): boolean {
  if (!requestUrl) return false
  try {
    return new URL(requestUrl, currentOrigin).origin === currentOrigin
  } catch {
    return false
  }
}
