// @ts-check
/**
 * `design-system` capability pack — Nuxt UI element discipline and the
 * Tailwind v4 token tier.
 *
 * Both halves are third-party in v2:
 *
 * - v1's eleven bespoke `no-native-*` element rules plus `prefer-uform` are one
 *   `vue/no-restricted-html-elements` configuration, one entry per element with
 *   the v1 message. That rule is maintained, understands `is=`/dynamic
 *   components, and reports on the element name rather than v1's start-tag node.
 * - v1's Tailwind tier (`no-raw-tailwind-colors`, `no-tailwind-v3-deprecated`,
 *   `no-invalid-nuxt-ui-token`, `prefer-tailwind-var-shorthand`) is
 *   `eslint-plugin-better-tailwindcss`, which resolves classes against the app's
 *   *actual* compiled Tailwind theme instead of v1's hand-maintained token list.
 *   Validated against a real `.vue` fixture (static `class`, `:class` array, and
 *   `:class` template literal) before adoption.
 *
 * `no-unknown-classes` and `no-deprecated-classes` need the app's Tailwind entry
 * stylesheet. The default below is the Nuxt UI 4 convention; an app whose entry
 * lives elsewhere overrides it:
 *
 * ```js
 * { settings: { 'better-tailwindcss': { entryPoint: 'app/assets/css/app.css' } } }
 * ```
 */

import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import vue from 'eslint-plugin-vue'

/** Nuxt UI 4 / narduk-template default Tailwind entry stylesheet. */
const TAILWIND_ENTRY_POINT = 'app/assets/css/main.css'

/** Raw Tailwind palette utilities v1's `no-raw-tailwind-colors` banned. */
const RAW_PALETTE_COLORS = [
  'gray',
  'zinc',
  'slate',
  'stone',
  'neutral',
  'green',
  'emerald',
  'blue',
  'red',
  'yellow',
  'orange',
  'purple',
  'pink',
  'indigo',
  'teal',
  'cyan',
  'amber',
  'lime',
  'fuchsia',
  'violet',
  'rose',
  'sky',
]

const RAW_PALETTE_UTILITIES = [
  'text',
  'bg',
  'border',
  'ring',
  'shadow',
  'divide',
  'from',
  'via',
  'to',
  'outline',
  'accent',
  'caret',
  'fill',
  'stroke',
]

const RAW_PALETTE_PATTERN = `^(?:${RAW_PALETTE_UTILITIES.join('|')})-(?:${RAW_PALETTE_COLORS.join('|')})-\\d{2,3}$`

/** One entry per element, carrying v1's guidance. */
const RESTRICTED_ELEMENTS = [
  { element: 'button', message: 'Use <UButton> instead of a native <button>.' },
  {
    element: ['input', 'textarea', 'select'],
    message: 'Use <UInput>, <UTextarea>, or <USelect> instead of a native form control.',
  },
  { element: 'form', message: 'Use <UForm> instead of a native <form>.' },
  { element: 'label', message: 'Use <UFormField> instead of a native <label>.' },
  { element: 'table', message: 'Use <UTable> instead of a native <table>.' },
  {
    element: ['details', 'summary'],
    message: 'Use <UCollapsible> or <UAccordion> instead of native <details>/<summary>.',
  },
  { element: 'hr', message: 'Use <USeparator> instead of a native <hr>.' },
  { element: 'progress', message: 'Use <UProgress> instead of a native <progress>.' },
  { element: 'dialog', message: 'Use <UModal> instead of a native <dialog>.' },
  { element: 'kbd', message: 'Use <UKbd> instead of a native <kbd>.' },
  { element: 'svg', message: 'Use <UIcon> instead of an inline <svg>.' },
]

/** v1 scoped the layout elements to pages and `app.vue` only. */
const RESTRICTED_LAYOUT_ELEMENTS = [
  { element: 'header', message: 'Use <UHeader> or a plain <div> instead of a native <header>.' },
  { element: 'footer', message: 'Use <UFooter> or a plain <div> instead of a native <footer>.' },
  { element: 'main', message: 'Use <UMain> or a plain <div> instead of a native <main>.' },
  { element: 'nav', message: 'Use <UNavigationMenu> or a plain <div> instead of a native <nav>.' },
]

/** @type {import('eslint').Linter.Config[]} */
const designSystemConfigs = [
  {
    name: 'narduk/design-system-elements',
    files: ['**/*.vue'],
    plugins: { vue },
    rules: {
      'vue/no-restricted-html-elements': ['error', ...RESTRICTED_ELEMENTS],
    },
  },

  {
    // v1 scoped `no-native-layout` to pages and `app.vue`. Flat config replaces
    // a rule's options rather than merging them, so this entry — which sorts
    // after the one above and matches a subset of its files — has to restate the
    // base element list at the same severity, or pages would silently lose it.
    name: 'narduk/design-system-layout-elements',
    files: ['**/pages/**/*.vue', '**/app.vue'],
    plugins: { vue },
    rules: {
      'vue/no-restricted-html-elements': [
        'error',
        ...RESTRICTED_ELEMENTS,
        ...RESTRICTED_LAYOUT_ELEMENTS,
      ],
    },
  },

  {
    name: 'narduk/design-system-tailwind',
    files: ['**/*.vue'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: {
      'better-tailwindcss': {
        entryPoint: TAILWIND_ENTRY_POINT,
      },
    },
    rules: {
      // The three theme-resolving rules are OFF here: without a resolvable
      // Tailwind entry point they do not degrade quietly — the plugin's shared
      // context emits a "No tailwind css entry point found at `…`. Option
      // `entryPoint` may be misconfigured" report per class (proven on the
      // workspace's own library packages, which have no CSS entry).
      // createAppLintConfig enables them when the app's entry point exists on
      // disk; standalone consumers opt in via
      // settings['better-tailwindcss'].entryPoint plus these rules.
      // Replaces narduk/no-invalid-nuxt-ui-token.
      'better-tailwindcss/no-unknown-classes': 'off',
      // Replaces narduk/no-tailwind-v3-deprecated.
      'better-tailwindcss/no-deprecated-classes': 'off',
      // Replaces narduk/no-raw-tailwind-colors.
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            {
              pattern: RAW_PALETTE_PATTERN,
              message:
                'Raw Tailwind palette class — use a Nuxt UI semantic class (text-dimmed, text-muted, text-primary, bg-elevated, bg-muted, bg-default, border-default).',
            },
          ],
        },
      ],
      // Replaces narduk/prefer-tailwind-var-shorthand (`p-[var(--x)]` → `p-(--x)`).
      // Theme-resolving like the two above — canonicalising an arbitrary value
      // needs the compiled theme — so it is gated the same way rather than
      // emitting the misconfiguration banner on every entry-point-less package.
      'better-tailwindcss/enforce-canonical-classes': 'off',
    },
  },
]

export { designSystemConfigs }
export default designSystemConfigs
