/**
 * `nitropack/runtime` for unit tests. narduk-ai does not depend on nitropack,
 * so narduk-core's logger bridge would otherwise resolve its own copy and no
 * `vi.mock('nitropack/runtime')` in this package could reach it. Tests replace
 * this module with `vi.mock`; unmocked, the runtime config is empty.
 */
export function useRuntimeConfig(): Record<string, unknown> {
  return {}
}
