import {
  getHealthCheckRegistry,
  type HealthCheckDefinition,
  normalizeHealthCheckDefinition,
} from '../health/checks'

export type {
  HealthCheckContext,
  HealthCheckDefinition,
  HealthCheckOutcome,
  HealthCheckRunResult,
} from '../health/checks'

/**
 * Add a named check to narduk-core's `GET /api/health`.
 *
 * Register from a Nitro plugin so the check exists before the first request.
 * Every registered check runs concurrently on each health request, and the
 * response lists each one with its result. A failing `required` check makes
 * the report `error` (HTTP 503); a failing optional check makes it `degraded`.
 * Registering a name again replaces the earlier check.
 *
 * @example
 * ```ts
 * // server/plugins/health-checks.ts
 * export default defineNitroPlugin(() => {
 *   registerHealthCheck({
 *     name: 'publication',
 *     required: true,
 *     async run({ signal }) {
 *       const manifest = await readManifest({ signal })
 *       return { detail: { releaseId: manifest.releaseId } }
 *     },
 *   })
 * })
 * ```
 *
 * @returns A function that removes this check again.
 */
export function registerHealthCheck(definition: HealthCheckDefinition): () => void {
  const check = normalizeHealthCheckDefinition(definition)
  const registry = getHealthCheckRegistry()
  registry.set(check.name, check)
  return () => {
    if (registry.get(check.name) === check) {
      registry.delete(check.name)
    }
  }
}
