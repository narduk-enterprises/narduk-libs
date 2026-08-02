/**
 * Rule: require-client-only-hydration-sensitive
 *
 * Components whose first render depends on `localStorage` or `matchMedia`
 * (colour-mode controls, the active-item state of `UNavigationMenu`) produce
 * different server and client markup and must be wrapped in `<ClientOnly>`.
 *
 * v1 was **exactly inverted** for the same reason as `require-client-only-switch`
 * (deep-review proof 1): `VElement.name` is lowercased by `vue-eslint-parser`, so
 * every `VElement[name="UNavigationMenu"]` selector was dead while the
 * `parent.name === 'ClientOnly'` ancestor test never matched. Rebuilt on
 * case-insensitive `rawName` matching and a real ancestor walk.
 */

import type { Rule } from 'eslint'

import { getFilename, isInsideClientOnly, tagNameOf, templateBodyVisitor } from './_internal'

/** Normalised (lowercase, dash-stripped) tag names — `<u-color-mode-button>` included. */
const HYDRATION_SENSITIVE_TAGS = new Set([
  'unavigationmenu',
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
        'require hydration-sensitive components (UNavigationMenu, UColorMode*) to be wrapped in <ClientOnly>',
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
