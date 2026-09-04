/**
 * Rule: require-client-only-switch
 *
 * `<USwitch>` renders a different DOM on the server than after hydration
 * (it reads its own indeterminate/checked state), so it must be wrapped in
 * `<ClientOnly>`.
 *
 * v1 was **exactly inverted** (deep-review proof 1): it selected
 * `VElement[name="USwitch"]`, but `vue-eslint-parser` lowercases `VElement.name`
 * (`uswitch`), so bare `<USwitch>` never reported; and its ancestor test compared
 * `parent.name === 'ClientOnly'`, which is likewise never true, so correctly
 * wrapped code reported instead. Both halves are rebuilt here on case- and
 * kebab-insensitive `rawName` matching plus a real ancestor walk.
 */

import type { Rule } from 'eslint'

import { getFilename, isInsideClientOnly, tagNameOf, templateBodyVisitor } from './_internal'

const SWITCH_TAGS = new Set(['uswitch'])

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'require <USwitch> to be wrapped in <ClientOnly>',
      recommended: true,
    },
    schema: [],
    messages: {
      requireClientOnly:
        '<{{name}}> must be wrapped in <ClientOnly> to avoid a hydration mismatch. Wrap it and provide a #fallback slot.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    if (!getFilename(context).endsWith('.vue')) return {}

    return templateBodyVisitor(context, {
      VElement(node: any) {
        if (!SWITCH_TAGS.has(tagNameOf(node))) return
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
