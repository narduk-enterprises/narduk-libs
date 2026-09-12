/**
 * One-time, dev-only deprecation notice for AppSettingsProfile (D4, narduk-libs#266).
 * Behaviour of the component is unchanged; this is a pointer at NeSettingsPage.
 */

export const APP_SETTINGS_PROFILE_DEPRECATION_MESSAGE =
  '[narduk-core] AppSettingsProfile is deprecated. Use NeSettingsPage from @narduk-enterprises/narduk-shell (currently pre-1.0) instead (narduk-libs#266). Removed in the next narduk-core major.'

let warned = false

/**
 * Warns once in development when AppSettingsProfile is used. `isDev` defaults
 * to Nuxt's `import.meta.dev` so production builds stay silent; tests pass
 * `true` or `false` explicitly.
 */
export function warnAppSettingsProfileDeprecated(isDev: boolean = Boolean(import.meta.dev)): void {
  if (!isDev || warned) return
  warned = true
  console.warn(APP_SETTINGS_PROFILE_DEPRECATION_MESSAGE)
}
