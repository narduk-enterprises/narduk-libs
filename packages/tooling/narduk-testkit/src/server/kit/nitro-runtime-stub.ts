/**
 * Stand-in for `nitropack/runtime` and Nuxt's `#imports` under plain Vitest
 * (narduk-libs#998), where no Nitro server is booted. `nuxtVitestAliases()`
 * from `server/kit/vitest` points both specifiers here, so one settable
 * runtime config reaches narduk-core, the app, and any third-party route that
 * imports `useRuntimeConfig` from either.
 *
 * Nothing else from the auto-import barrel is re-exported on purpose: a module
 * that needs another auto-import fails loudly instead of resolving to a
 * silent stand-in.
 *
 * `{}` is the default: the configuration of a deployment that set nothing.
 */

let runtimeConfig: Record<string, unknown> = {}

/** What server code reads. `{}` until a test sets something. */
export function useRuntimeConfig(): Record<string, unknown> {
  return runtimeConfig
}

/**
 * Nitro's request async-local storage is not installed under plain Vitest. A
 * reader that treats a throw as "no request context" gets exactly that.
 */
export function useEvent(): never {
  throw new Error('Nitro request context is not available under plain Vitest.')
}

/** Set the config `useRuntimeConfig()` returns, for the current test. */
export function setTestRuntimeConfig(config: Record<string, unknown>): void {
  runtimeConfig = config
}

/** Back to `{}`. Call from `beforeEach`/`afterEach` so a value never leaks into the next test. */
export function resetTestRuntimeConfig(): void {
  runtimeConfig = {}
}
