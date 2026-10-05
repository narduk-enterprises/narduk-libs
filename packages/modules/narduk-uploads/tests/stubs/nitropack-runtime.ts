/**
 * `nitropack/runtime` for unit tests. narduk-core's logger bridge reads Nitro's
 * runtime config through this id; aliasing it here gives the bridge and this
 * package's `vi.mock('nitropack/runtime')` one module. Unmocked, it is empty.
 */
export function useRuntimeConfig(): Record<string, unknown> {
  return {}
}
