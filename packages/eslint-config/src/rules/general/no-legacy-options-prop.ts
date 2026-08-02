/**
 * Nuxt UI v4 renamed the `options` prop to `items` on the select-family
 * components. Older docs and every LLM trained on them still emit `options`.
 *
 * Deep-review verdict: SOLID / KEEP (6 tests).
 *
 * The `component-utils` normalizer is inlined rather than imported: v1's shared
 * copy also carried `isNuxtUIComponent`, whose `U*`-prefix catalog check the
 * review proved reports on any app component named `U…` (`UserCard`,
 * `UploadDropzone`). That function is dropped with `no-unknown-nuxt-ui-component`
 * (REPLACE → `vue/no-undef-components`); only the name normalizer survives, and
 * it survives here rather than as a shared module nothing else needs.
 *
 * Autofix KEPT. Every fix replaces the *argument* or *key* range only — never
 * the value, never the whole attribute — so the rewrite is `:options="x"` →
 * `:items="x"` with the binding untouched. Dynamic arguments (`v-bind:[prop]`)
 * parse to a `VExpressionContainer` argument, are skipped before the report,
 * and therefore cannot be corrupted. Proven by the `output:` assertions on
 * every invalid case including the shorthand, longhand and static-attribute
 * spellings.
 *
 * Typed against vue-eslint-parser's OWN `VAttribute | VDirective` union.
 * DESIGN.md drops v1's hand-written `types/vue-eslint-parser.d.ts`, which the
 * review proved wrong (it declared `VDirective { type: 'VDirective' }`, against
 * the parser's actual `type: 'VAttribute'` + `directive: true` discriminant,
 * and directly caused review proof 8). v1's `range != null` guards existed only
 * because those fake types made `range` look optional; the real `HasLocation`
 * declares it required, so they are gone.
 */

import type { AST } from 'vue-eslint-parser'
import type { Rule } from 'eslint'

const ITEMS_COMPONENTS = new Set(['USelect', 'USelectMenu', 'UInputMenu'])

/** v1 `component-utils.normalizeComponentName(name, ['U'])`, behaviour-for-behaviour. */
function normalizeComponentName(name: string): string | null {
  if (name.charAt(0) === name.charAt(0).toUpperCase() && !name.includes('-')) {
    return name.startsWith('U') ? name : null
  }

  let pascalCase: string
  if (name.includes('-')) {
    pascalCase = name
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('')
  } else {
    const firstChar = name.charAt(0).toUpperCase()
    const rest = name.slice(1)
    pascalCase =
      name.length > 1 && name.charAt(0).toLowerCase() === name.charAt(0)
        ? firstChar + (rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase())
        : firstChar + rest
  }

  return pascalCase.startsWith('U') ? pascalCase : null
}

type TemplateAttribute = AST.VAttribute | AST.VDirective

function isDirective(attr: TemplateAttribute): attr is AST.VDirective {
  return attr.directive
}

/** The static argument of a directive, or `null` for none / a dynamic one. */
function getDirectiveArgument(key: AST.VDirectiveKey): AST.VIdentifier | null {
  return key.argument?.type === 'VIdentifier' ? key.argument : null
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow the legacy `options` prop on Nuxt UI select-style components',
      recommended: true,
    },
    fixable: 'code' as const,
    schema: [],
    messages: {
      preferItems: '{{componentName}} uses `items`, not "{{propName}}", in Nuxt UI v4.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const parserServices = context.sourceCode?.parserServices as any
    if (!parserServices?.defineTemplateBodyVisitor) {
      return {}
    }

    return parserServices.defineTemplateBodyVisitor({
      VElement(node: AST.VElement) {
        // `VElement.name` is lowercased by vue-eslint-parser; `rawName` carries
        // the source casing. Matching on `name` would make `USelectMenu`
        // normalize to `USelectmenu` and silently miss the component — the same
        // lowercase-name trap the review proved had inverted the two
        // `require-client-only-*` hydration rules.
        const componentName = normalizeComponentName(node.rawName ?? node.name)

        if (!componentName || !ITEMS_COMPONENTS.has(componentName)) {
          return
        }

        for (const attr of node.startTag.attributes as TemplateAttribute[]) {
          if (isDirective(attr)) {
            const argument = getDirectiveArgument(attr.key)

            if (attr.key.name.name !== 'bind' || !argument || argument.name !== 'options') {
              continue
            }

            const range = argument.range
            context.report({
              node: attr,
              messageId: 'preferItems',
              data: { componentName, propName: argument.name },
              fix: (fixer) => fixer.replaceTextRange(range, 'items'),
            })
            continue
          }

          if (attr.key.name !== 'options') {
            continue
          }

          const range = attr.key.range
          context.report({
            node: attr,
            messageId: 'preferItems',
            data: { componentName, propName: attr.key.name },
            fix: (fixer) => fixer.replaceTextRange(range, 'items'),
          })
        }
      },
    }) as Rule.RuleListener
  },
} satisfies Rule.RuleModule
