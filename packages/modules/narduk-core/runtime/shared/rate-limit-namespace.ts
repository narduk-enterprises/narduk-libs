/**
 * Account-unique Cloudflare rate-limit `namespace_id`s (narduk-libs#433).
 *
 * Cloudflare: "`namespace_id` uniquely defines this rate limiting namespace
 * within your Cloudflare account." Two bindings with the same id share
 * counters across every Worker on the account, so a copied example id
 * (`1001`, or the scaffold's `50110`/`50121`/`50300`) silently couples apps.
 *
 * The scheme, deterministic from the Worker `name`:
 *
 * 1. FNV-1a 32-bit over the UTF-8 bytes of the Worker name;
 * 2. reduced to a five-digit prefix in `10000`–`49999` (clear of the copied
 *    scaffold band and of `1001`);
 * 3. the binding's per-minute `limit`, padded to three digits, appended with
 *    no separator — so `RL_60` and `RL_600` cannot collide.
 *
 * Existing unique, non-scaffold ids (Buoys' `2869300`/`2869120`) are
 * grandfathered; only the scaffold defaults are wrong.
 *
 * Dependency-free so a generator, a doctor check or an app's own wrangler
 * test can compute the same value.
 */

/** Ids known to have been pasted from scaffolds or documentation. */
export const RATE_LIMIT_SCAFFOLD_NAMESPACE_IDS: readonly string[] = [
  '1001',
  '50110',
  '50121',
  '50300',
]

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const PREFIX_FLOOR = 10_000
const PREFIX_SPAN = 40_000

/** The five-digit, account-unique-by-construction prefix for a Worker name. */
export function rateLimitNamespacePrefix(workerName: string): string {
  if (typeof workerName !== 'string' || workerName.trim().length === 0) {
    throw new TypeError('rateLimitNamespacePrefix needs the non-empty Worker name.')
  }
  let hash = FNV_OFFSET_BASIS
  for (const byte of new TextEncoder().encode(workerName)) {
    hash ^= byte
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return String(PREFIX_FLOOR + (hash % PREFIX_SPAN))
}

/** The `ratelimits[].namespace_id` for one `RL_<limit>` binding of one Worker. */
export function rateLimitNamespaceId(workerName: string, limit: number): string {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError('rateLimitNamespaceId needs a positive integer per-minute limit.')
  }
  return `${rateLimitNamespacePrefix(workerName)}${String(limit).padStart(3, '0')}`
}
