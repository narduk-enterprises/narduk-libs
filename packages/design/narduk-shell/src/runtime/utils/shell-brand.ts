/**
 * The `accent` / `structure` brand overrides as one CSS rule (components
 * backlog item 18, narduk-libs#265).
 *
 * `theme.css` says an app sets exactly two tokens, `--ne-accent` and
 * `--ne-structure`. The `nardukShell.accent` / `.structure` options are the
 * config form of that, and this function is the whole of what they do: it
 * turns them into one rule that the brand plugin
 * (`src/runtime/plugins/shell-brand.ts`) puts in the document head.
 *
 * ## Why the head, and why these selectors
 *
 * The override has to reach teleported overlays — a `UModal`, a `USlideover`,
 * the shell's own mobile drawer — which Nuxt UI mounts under `<body>`,
 * outside every component's subtree. A style on the shell's root element
 * would stop at the shell. A document-level rule on `:root` reaches all of
 * them, and a `<style>` in the head is in the server's first paint, so there
 * is no flash of the default accent before hydration.
 *
 * `theme.css` also declares both tokens on `.light` / `.dark` (which
 * `@nuxtjs/color-mode` stamps on `<html>`, and which a subtree may carry to
 * pin its scheme) and on `:root[data-ne-scheme='auto']` inside a media query.
 * A plain `:root` would lose to all of those. So the rule is:
 *
 * - `:root:root:root` — specificity (0,3,0), above every `theme.css` selector
 *   that can match `<html>` ((0,2,0) at most), without `!important`; and
 * - `:root .light, :root .dark` — (0,2,0), above a scheme-pinned subtree's own
 *   `.light` / `.dark` (0,1,0), so a pinned preview still takes the app's
 *   brand.
 *
 * No `!important`: an app that also writes the token in its own stylesheet can
 * still win with a more specific selector, which is the escape hatch the
 * README documents.
 *
 * One value serves both schemes. The options are a single colour each, as the
 * plan fixed them; an app that needs a different dark-mode accent sets the
 * tokens in CSS instead (README § Styling contract).
 */

/** The two tokens an app is expected to set, and nothing else. */
export interface NeShellBrand {
  accent?: string
  structure?: string
}

/**
 * The selector list the override is declared on. Exported so a test can prove
 * it outranks every selector `theme.css` declares the tokens on.
 */
export const SHELL_BRAND_SELECTOR = ':root:root:root, :root .light, :root .dark'

/**
 * A colour value that cannot leave its declaration: hex, a colour function
 * (`rgb()`, `oklch()`, `color-mix()`), a `var()` read, a keyword. What it
 * refuses — `;`, braces, quotes, angle brackets, backslashes — is exactly
 * what it would take to end the declaration, open another rule or close the
 * `<style>` element. The value comes from the app's own config, so this is a
 * guard against a typo becoming a broken stylesheet as much as against
 * injection.
 */
const SAFE_VALUE = /^[\w\s#%(),./+-]+$/

/** `value` trimmed when it is a usable colour value, otherwise `undefined`. */
export function safeBrandValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed !== '' && SAFE_VALUE.test(trimmed) ? trimmed : undefined
}

/**
 * The override rule, or `''` when neither option carries a usable value — in
 * which case nothing is overridden and `theme.css`'s defaults stand.
 */
export function shellBrandCss(brand: NeShellBrand | null | undefined): string {
  const accent = safeBrandValue(brand?.accent)
  const structure = safeBrandValue(brand?.structure)
  const declarations = [
    accent ? `--ne-accent: ${accent};` : '',
    structure ? `--ne-structure: ${structure};` : '',
  ].filter(Boolean)
  return declarations.length === 0 ? '' : `${SHELL_BRAND_SELECTOR} { ${declarations.join(' ')} }`
}
