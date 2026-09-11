/**
 * One-time, dev-only deprecation notice for AppConfirmModal (D4, narduk-libs#263).
 * Behaviour of the component is unchanged; this is a pointer at NeConfirmDialog.
 */

export const APP_CONFIRM_MODAL_DEPRECATION_MESSAGE =
  '[narduk-core] AppConfirmModal is deprecated. Use NeConfirmDialog / useConfirm() from @narduk-enterprises/narduk-shell instead (narduk-libs#263). Removed in the next narduk-core major.'

let warned = false

/**
 * Warns once in development when AppConfirmModal is used. `isDev` defaults to
 * Nuxt's `import.meta.dev` so production builds stay silent; tests pass `true`
 * or `false` explicitly.
 */
export function warnAppConfirmModalDeprecated(isDev: boolean = Boolean(import.meta.dev)): void {
  if (!isDev || warned) return
  warned = true
  console.warn(APP_CONFIRM_MODAL_DEPRECATION_MESSAGE)
}
