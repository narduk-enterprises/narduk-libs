/**
 * Service bindings in an E2E run (narduk-libs#788).
 *
 * `e2e-serve` starts exactly one Worker. A `services` binding to any other
 * Worker has no target in that run, and workerd refuses to start:
 * `binding "ENGINE" refers to a service "core:user:…", but no such service is
 * defined`. Those bindings are dropped so the app sees the binding as missing
 * (its own 503 path) instead of the whole run failing. A binding back to the
 * Worker itself has a target and is kept.
 */

export interface E2eServiceBinding {
  binding: string
  service: string
  entrypoint?: string
  [key: string]: unknown
}

export interface E2eWranglerConfig {
  name?: string
  services?: E2eServiceBinding[]
  [key: string]: unknown
}

export interface E2eServiceBindingPlan<T extends E2eServiceBinding = E2eServiceBinding> {
  keep: T[]
  drop: T[]
}

/** First wrangler release whose `unstable_startWorker` accepts a config object. */
export const WRANGLER_INLINE_CONFIG_MIN_VERSION = '4.99.0'

/**
 * Split a Worker's service bindings into those with a target in a one-Worker
 * run (bindings to `workerName` itself) and those without one.
 */
export function planE2eServiceBindings<T extends E2eServiceBinding>(
  workerName: string | undefined,
  services: readonly T[] | undefined,
): E2eServiceBindingPlan<T> {
  const keep: T[] = []
  const drop: T[] = []
  for (const entry of services ?? []) {
    if (workerName && entry.service === workerName) keep.push(entry)
    else drop.push(entry)
  }
  return { keep, drop }
}

/**
 * Return `config` without the service bindings whose target Worker is not part
 * of the run. The input is not mutated; when nothing is dropped the same object
 * comes back.
 */
export function stripExternalServiceBindings<C extends E2eWranglerConfig>(
  config: C,
): { config: C; dropped: E2eServiceBinding[] } {
  const { keep, drop } = planE2eServiceBindings(config.name, config.services)
  if (drop.length === 0) return { config, dropped: [] }
  return { config: { ...config, services: keep }, dropped: drop }
}

export function describeDroppedServiceBinding(entry: E2eServiceBinding): string {
  const target = entry.entrypoint
    ? `${entry.service} (entrypoint ${entry.entrypoint})`
    : entry.service
  return `dropping service binding ${entry.binding} → ${target} (not part of the E2E run)`
}

/** Whether `version` (a wrangler semver) is at or above `minimum`. Unparseable is false. */
export function wranglerSupportsInlineConfig(
  version: string | undefined,
  minimum = WRANGLER_INLINE_CONFIG_MIN_VERSION,
): boolean {
  const actual = parseSemver(version)
  const floor = parseSemver(minimum)
  if (!actual || !floor) return false
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== floor[index]) return actual[index] > floor[index]
  }
  return true
}

function parseSemver(version: string | undefined): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '')
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
