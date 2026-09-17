/**
 * The two values `<AppMapKit>` accepts from its host application by injection.
 *
 * ## Colour mode
 *
 * 2.0.x watched `document.documentElement.classList` with a `MutationObserver`,
 * one per map. That is a per-map global observer for something the app already
 * knows, and it has no answer at all for an app whose dark mode is not a class
 * on `<html>`. `colorScheme: 'auto'` now reads whatever ref the app provides.
 *
 * ## Nonce
 *
 * The spec's §c.1 default for `nonce` is `useNonce()`. No such composable exists
 * in this estate -- `narduk-core` does not export one and Nuxt does not ship one
 * -- so making it the default would bind this package to a composable that has
 * to be invented first. The prop still wins; an app under `strictDynamic: true`
 * either passes `:nonce` or provides it once at the layout level through this
 * key. The deviation is recorded in narduk-libs#422.
 */
import type { InjectionKey } from 'vue'

/** Anything with a `.value` of `'dark'` | `'light'` | an app's own mode string. */
export const mapKitColorModeInjectionKey: InjectionKey<{ readonly value: string }> = Symbol.for(
  'narduk-mapkit:color-mode',
)

export const mapKitNonceInjectionKey: InjectionKey<string> = Symbol.for('narduk-mapkit:nonce')
