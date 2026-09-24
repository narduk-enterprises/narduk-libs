/**
 * The account-unique rate-limit `namespace_id` prefix for a Worker name
 * (narduk-libs#433): FNV-1a 32-bit over the UTF-8 name, reduced into
 * `10000`–`49999`. A copy of narduk-core's `rateLimitNamespacePrefix`, which a
 * one-shot generator cannot import; tests pin both to the same vectors.
 */
export function rateLimitNamespacePrefix(workerName: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(workerName)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return String(10_000 + (hash % 40_000))
}
