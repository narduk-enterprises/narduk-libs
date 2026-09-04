/** @returns trimmed `twitterSite` for `useSeoMeta` or `undefined` if unset. */
export function resolvePublicTwitterSite(publicRuntime: {
  twitterSite?: string
}): string | undefined {
  if (typeof publicRuntime.twitterSite === 'string' && publicRuntime.twitterSite.trim() !== '') {
    return publicRuntime.twitterSite.trim()
  }
  return undefined
}
