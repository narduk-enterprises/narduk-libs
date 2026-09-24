/**
 * When narduk-core installs `nuxt-auth-utils` (`coreModules` on), that
 * module's session plugin fetches `/api/_auth/session` during every SSR. With
 * no session password the handler throws, which is the error a published-data
 * app with no auth (Buoys) logs on every render (narduk-libs#540).
 *
 * `nuxt-auth-utils` already has the gate: `auth.loadStrategy: 'none'` skips
 * both session plugins and leaves `useUserSession` available for dashboard
 * chrome. We pass that when the app has not configured auth, and leave the
 * default (`server-first`) when it has. An app that already set
 * `auth.loadStrategy` keeps its own value.
 *
 * `nardukCore.auth: false` skips the install entirely and does not seed an
 * empty session password (narduk-libs#169). That is the opt-out for a site
 * with no accounts; `loadStrategy: 'none'` is not a substitute. With auth off,
 * core registers a signed-out `useUserSession` for its dashboard chrome, and
 * refuses the build when narduk-auth is installed with nothing else providing
 * `nuxt-auth-utils`.
 */

export type NuxtAuthUtilsLoadStrategy = 'client-only' | 'none' | 'server-first'

export interface NuxtAuthUtilsInstallSignals {
  /** `auth.loadStrategy` already set on the Nuxt options (app-owned). */
  configuredLoadStrategy?: unknown
  env?: Record<string, string | undefined>
  modules?: unknown[]
  runtimeConfig?: Record<string, unknown>
}

export interface NuxtAuthUtilsInstallOptions {
  loadStrategy?: NuxtAuthUtilsLoadStrategy
}

const NARDUK_AUTH_PACKAGE_NAMES = new Set([
  '@narduk-enterprises/narduk-auth',
  '@narduk-enterprises/narduk-auth/nuxt',
])

const NUXT_AUTH_UTILS_PACKAGE_NAME = 'nuxt-auth-utils'

/** `meta.name` that `nuxt-auth-utils` registers under (`_installedModules`). */
const NUXT_AUTH_UTILS_META_NAME = 'auth-utils'

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function moduleEntryName(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0]
  return undefined
}

export function isAuthLoadStrategy(value: unknown): value is NuxtAuthUtilsLoadStrategy {
  return value === 'client-only' || value === 'none' || value === 'server-first'
}

function normalizedModuleNames(modules: unknown[] | undefined): string[] {
  const names: string[] = []
  for (const entry of modules ?? []) {
    const name = moduleEntryName(entry)
    if (name) names.push(name.replaceAll('\\', '/'))
  }
  return names
}

/** `@narduk-enterprises/narduk-auth` (or a workspace path to it) in `modules`. */
export function moduleDeclaresNardukAuth(modules: unknown[] | undefined): boolean {
  return normalizedModuleNames(modules).some(
    (name) =>
      NARDUK_AUTH_PACKAGE_NAMES.has(name) ||
      name.endsWith('/narduk-auth') ||
      name.endsWith('/narduk-auth/nuxt') ||
      name.endsWith('/narduk-auth/src/module'),
  )
}

/** `nuxt-auth-utils` listed in the app's own `modules`. */
export function moduleDeclaresNuxtAuthUtils(modules: unknown[] | undefined): boolean {
  return normalizedModuleNames(modules).includes(NUXT_AUTH_UTILS_PACKAGE_NAME)
}

export function moduleDeclaresAuth(modules: unknown[] | undefined): boolean {
  return moduleDeclaresNardukAuth(modules) || moduleDeclaresNuxtAuthUtils(modules)
}

export function sessionPasswordConfigured(
  env: Record<string, string | undefined> | undefined,
  runtimeConfig: Record<string, unknown> | undefined,
): boolean {
  if (trimmed(env?.NUXT_SESSION_PASSWORD) || trimmed(env?.SESSION_PASSWORD)) {
    return true
  }
  const session = runtimeConfig?.session
  if (session && typeof session === 'object') {
    return Boolean(trimmed((session as { password?: unknown }).password))
  }
  return false
}

export function resolveNuxtAuthUtilsInstallOptions(
  signals: NuxtAuthUtilsInstallSignals = {},
): NuxtAuthUtilsInstallOptions {
  // Any app-set value is preserved, not only the three strategies this package
  // recognises. A typo, or a strategy from a newer `nuxt-auth-utils`, is the
  // app's to own and that module's to reject; replacing it here would disable
  // the session plugin silently instead of surfacing the bad config
  // (narduk-libs#542).
  if (signals.configuredLoadStrategy !== undefined) return {}
  if (
    sessionPasswordConfigured(signals.env, signals.runtimeConfig) ||
    moduleDeclaresAuth(signals.modules)
  ) {
    return {}
  }
  return { loadStrategy: 'none' }
}

/** `nardukCore.auth` defaults to true; only an explicit `false` opts out. */
export function shouldInstallNuxtAuthUtils(auth: boolean | undefined): boolean {
  return auth !== false
}

export function sessionRuntimeConfigSeed(
  auth: boolean | undefined,
  env: Record<string, string | undefined> | undefined,
): { session: { password: string } } | Record<string, never> {
  if (!shouldInstallNuxtAuthUtils(auth)) return {}
  return {
    session: {
      password: env?.NUXT_SESSION_PASSWORD || '',
    },
  }
}

export async function maybeInstallNuxtAuthUtils(
  auth: boolean | undefined,
  install: (name: string, options?: NuxtAuthUtilsInstallOptions) => Promise<unknown> | unknown,
  signals: NuxtAuthUtilsInstallSignals,
): Promise<void> {
  if (!shouldInstallNuxtAuthUtils(auth)) return
  await install('nuxt-auth-utils', resolveNuxtAuthUtilsInstallOptions(signals))
}

export interface AuthOptOutSignals {
  /** `nardukCore.auth`; only an explicit `false` is the opt-out. */
  auth: boolean | undefined
  /** `nuxt.options._installedModules`, read once every module is installed. */
  installedModules?: ReadonlyArray<{ meta?: { name?: unknown } }>
  /** `nuxt.options.modules`. */
  modules?: unknown[]
  /** narduk-auth installed by any route (`usesNardukAuth(runtimeConfig)`). */
  nardukAuthInstalled?: boolean
}

/**
 * True when `nuxt-auth-utils` is installed by something other than core: the
 * app's own `modules`, a layer, or another module's `installModule`.
 */
export function nuxtAuthUtilsInstalled(
  signals: Pick<AuthOptOutSignals, 'installedModules' | 'modules'>,
): boolean {
  if (moduleDeclaresNuxtAuthUtils(signals.modules)) return true
  return (signals.installedModules ?? []).some(
    (entry) => entry?.meta?.name === NUXT_AUTH_UTILS_META_NAME,
  )
}

/**
 * The build-time message for `nardukCore.auth: false` in an app that cannot
 * work without the session module, or `null`.
 *
 * narduk-auth signs users in through `nuxt-auth-utils` (`setUserSession`,
 * `useUserSession`) and does not install it: it relies on core. So auth off
 * plus narduk-auth, with nothing else installing `nuxt-auth-utils`, would build
 * and then fail on the first sign-in. An app that lists `nuxt-auth-utils` in
 * its own `modules` installs it itself, and that combination is allowed.
 */
export function findAuthOptOutConflict(signals: AuthOptOutSignals): string | null {
  if (shouldInstallNuxtAuthUtils(signals.auth)) return null
  const nardukAuth = signals.nardukAuthInstalled || moduleDeclaresNardukAuth(signals.modules)
  if (!nardukAuth || nuxtAuthUtilsInstalled(signals)) return null
  return (
    '[narduk-core] nardukCore.auth: false conflicts with @narduk-enterprises/narduk-auth: ' +
    'narduk-auth keeps its sessions in nuxt-auth-utils, which auth: false does not install. ' +
    "Remove auth: false, remove narduk-auth, or add 'nuxt-auth-utils' to modules yourself."
  )
}

export const USER_SESSION_IMPORT_NAME = 'useUserSession'

/**
 * Whether core should register its signed-out `useUserSession`
 * (`runtime/app/session/useUserSessionStub.ts`). Only with `app` on (the
 * dashboard components that call it are registered) and `auth: false`, and
 * only when nothing else provides the name: an app that installs
 * `nuxt-auth-utils` itself keeps the real composable.
 */
export function shouldRegisterUserSessionStub(
  signals: Pick<AuthOptOutSignals, 'auth' | 'installedModules' | 'modules'> & {
    app: boolean | undefined
    /** Auto-imports registered so far (`imports:extend`). */
    imports?: ReadonlyArray<{ as?: unknown; name?: unknown }>
  },
): boolean {
  if (!signals.app || shouldInstallNuxtAuthUtils(signals.auth)) return false
  if (nuxtAuthUtilsInstalled(signals)) return false
  return !(signals.imports ?? []).some(
    (entry) => (entry.as ?? entry.name) === USER_SESSION_IMPORT_NAME,
  )
}
