/**
 * Rule: require-client-only-hydration-sensitive
 *
 * Components whose first render depends on `localStorage` or `matchMedia` — the
 * `UColorMode*` controls, which render the stored or system colour mode —
 * produce different server and client markup and must be wrapped in
 * `<ClientOnly>`.
 *
 * `UNavigationMenu` is deliberately not in the list (narduk-libs#1237 burndown).
 * It was listed as reading client-only active-item state, but it reads none:
 * `@nuxt/ui` 4.11.1's `NavigationMenu.vue` and the reka-ui 2.10.4
 * `NavigationMenu` / `Accordion` primitives it renders touch no
 * `localStorage`, `matchMedia`, `useMediaQuery`, `useStorage`, `window` or
 * `document`. Its active item comes from the router's `RouterLink` match
 * against the current route, which is the same on the server and the client.
 * Forcing it into `<ClientOnly>` removed navigation from the server's first
 * paint for no hydration benefit (narduk-shell's `NeAppShell` rail).
 * One caveat: the server never sees the URL hash, so an item with `exactHash`
 * (or an `active` flag computed from the hash) marks a different item active
 * on the server and the client. That is true of any hash-matched link, not of
 * the menu, so this rule does not try to catch it.
 *
 * v1 was **exactly inverted** for the same reason as `require-client-only-switch`
 * (deep-review proof 1): `VElement.name` is lowercased by `vue-eslint-parser`, so
 * every `VElement[name="..."]` selector was dead while the
 * `parent.name === 'ClientOnly'` ancestor test never matched. Rebuilt on
 * case-insensitive `rawName` matching and a real ancestor walk.
 */

import type { Rule } from 'eslint'

import { getFilename, isInsideClientOnly, tagNameOf, templateBodyVisitor } from './_internal'

/** Normalised (lowercase, dash-stripped) tag names — `<u-color-mode-button>` included. */
const HYDRATION_SENSITIVE_TAGS = new Set([
  'ucolormodebutton',
  'ucolormodeselect',
  'ucolormodeswitch',
  'ucolormodeavatar',
  'ucolormodeimage',
])

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'require hydration-sensitive components (UColorMode*) to be wrapped in <ClientOnly>',
      recommended: true,
    },
    schema: [],
    messages: {
      requireClientOnly:
        '<{{name}}> reads client-only state (localStorage/matchMedia) and must be wrapped in <ClientOnly> to avoid a hydration mismatch. Provide a #fallback slot.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    if (!getFilename(context).endsWith('.vue')) return {}

    return templateBodyVisitor(context, {
      VElement(node: any) {
        if (!HYDRATION_SENSITIVE_TAGS.has(tagNameOf(node))) return
        if (isInsideClientOnly(node)) return

        context.report({
          node: node.startTag ?? node,
          messageId: 'requireClientOnly',
          data: { name: String(node.rawName ?? node.name) },
        })
      },
    })
  },
} satisfies Rule.RuleModule
