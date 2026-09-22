/**
 * `narduk-app doctor`'s rate-limit namespace check (narduk-libs#433).
 *
 * Cloudflare `ratelimits[].namespace_id` is unique per **account**, not per
 * Worker: two bindings with the same id share counters across every Worker on
 * the account. So a pasted example id silently couples apps, and one id reused
 * by two environments of one app couples preview and production.
 *
 * The scheme that avoids both is narduk-core's `rateLimitNamespaceId` (FNV-1a
 * of the Worker name, then the per-minute limit). This check does not require
 * it -- an app already on its own unique ids keeps them -- it refuses the
 * shapes that are wrong whatever the scheme: a known scaffold id, an id
 * declared twice in one config, and an id that is not a positive decimal
 * integer.
 */

/** Ids pasted from scaffolds or documentation. Mirrors narduk-core's
 * `RATE_LIMIT_SCAFFOLD_NAMESPACE_IDS`; a test pins the two together. */
export const SCAFFOLD_NAMESPACE_IDS: readonly string[] = ['1001', '50110', '50121', '50300']

export interface RateLimitBinding {
  /** `ratelimits` for the top level, `env.<name>.ratelimits` otherwise. */
  scope: string
  name: string
  namespaceId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bindingsIn(block: unknown, scope: string): RateLimitBinding[] {
  if (!Array.isArray(block)) return []
  return block.filter(isRecord).map((entry) => ({
    scope,
    name: typeof entry.name === 'string' ? entry.name : '<unnamed>',
    namespaceId:
      typeof entry.namespace_id === 'string' || typeof entry.namespace_id === 'number'
        ? String(entry.namespace_id)
        : null,
  }))
}

/** Every `ratelimits` binding a wrangler config declares, top level and `env.*`. */
export function rateLimitBindings(config: unknown): RateLimitBinding[] {
  if (!isRecord(config)) return []
  const found = bindingsIn(config.ratelimits, 'ratelimits')
  if (isRecord(config.env)) {
    for (const [env, scope] of Object.entries(config.env)) {
      if (isRecord(scope)) found.push(...bindingsIn(scope.ratelimits, `env.${env}.ratelimits`))
    }
  }
  return found
}

/** What is wrong with a config's rate-limit namespace ids; empty when nothing. */
export function rateLimitNamespaceIssues(config: unknown): string[] {
  const bindings = rateLimitBindings(config)
  const issues: string[] = []
  const byId = new Map<string, RateLimitBinding[]>()
  for (const binding of bindings) {
    const where = `${binding.scope} ${binding.name}`
    if (binding.namespaceId === null) {
      issues.push(`${where} declares no namespace_id`)
      continue
    }
    if (!/^[1-9]\d*$/.test(binding.namespaceId)) {
      issues.push(
        `${where} has namespace_id ${JSON.stringify(binding.namespaceId)}, which is not a ` +
          `positive decimal integer`,
      )
      continue
    }
    if (SCAFFOLD_NAMESPACE_IDS.includes(binding.namespaceId)) {
      issues.push(
        `${where} uses namespace_id ${binding.namespaceId}, a scaffold id other Workers on the ` +
          `account already count against`,
      )
    }
    byId.set(binding.namespaceId, [...(byId.get(binding.namespaceId) ?? []), binding])
  }
  for (const [id, sharing] of byId) {
    if (sharing.length < 2) continue
    issues.push(
      `namespace_id ${id} is declared ${sharing.length} times ` +
        `(${sharing.map((binding) => `${binding.scope} ${binding.name}`).join(', ')}), so they ` +
        `share one set of counters`,
    )
  }
  return issues
}

/** The fix every failure points at. */
export const RATE_LIMIT_NAMESPACE_FIX =
  'derive each id from the Worker name with rateLimitNamespaceId(workerName, limit) from ' +
  '@narduk-enterprises/narduk-core/shared/rate-limit-namespace, one distinct Worker name per ' +
  'environment'
