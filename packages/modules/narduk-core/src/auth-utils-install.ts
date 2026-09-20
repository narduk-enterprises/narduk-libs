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

const AUTH_PACKAGE_NAMES = new Set([
  '@narduk-enterprises/narduk-auth',
  '@narduk-enterprises/narduk-auth/nuxt',
  'nuxt-auth-utils',
])

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

export function moduleDeclaresAuth(modules: unknown[] | undefined): boolean {
  for (const entry of modules ?? []) {
    const name = moduleEntryName(entry)
    if (!name) continue
    const normalized = name.replaceAll('\\', '/')
    if (AUTH_PACKAGE_NAMES.has(normalized)) return true
    if (
      normalized.endsWith('/narduk-auth') ||
      normalized.endsWith('/narduk-auth/nuxt') ||
      normalized.endsWith('/narduk-auth/src/module')
    ) {
      return true
    }
  }
  return false
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
