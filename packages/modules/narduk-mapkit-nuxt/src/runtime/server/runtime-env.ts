export type MapKitRuntimeEnv = Record<string, unknown>

/** Read known keys directly because Cloudflare bindings may not enumerate. */
export function readMapKitRuntimeString(
  sources: readonly MapKitRuntimeEnv[],
  keys: readonly string[],
  fallback: unknown,
): string {
  for (const source of sources) {
    for (const key of keys) {
      try {
        const value = source[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
      } catch {
        // Some non-data Worker bindings throw on property access; try the next source.
      }
    }
  }
  return typeof fallback === 'string' ? fallback.trim() : ''
}
