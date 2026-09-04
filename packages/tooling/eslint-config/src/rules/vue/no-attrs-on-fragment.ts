/**
 * Rule: no-attrs-on-fragment
 *
 * Vue cannot apply fallthrough attributes to a component that renders a
 * fragment, a `<Teleport>` root, or bare text, so a parent passing `class`/`style`
 * gets the "Extraneous non-props attributes" runtime warning and silently loses
 * the styling. Either give the component a single root element or declare
 * `inheritAttrs: false`.
 *
 * Kept from v1 (which correctly used `rawName`) with two deep-review fixes:
 *
 *  - a `v-if` / `v-else-if` / `v-else` chain at the root is a *single* runtime
 *    root, not a fragment — v1 false-positived on it;
 *  - `defineComponent({ inheritAttrs: false })` now suppresses the report
 *    alongside `defineOptions` and `export default { … }`.
 */

import type { Rule } from 'eslint'

import { getFilename } from './_internal'
import { templateBodyVisitor } from '../hydration/_internal'

/** Root tags that can never receive fallthrough attributes, even alone. */
const UNINHERITABLE_ROOT_TAGS = new Set(['teleport', 'template'])

const BRANCH_DIRECTIVES = new Set(['if', 'else-if', 'else'])

function directiveNames(element: any): Set<string> {
  const names = new Set<string>()
  for (const attribute of element?.startTag?.attributes ?? []) {
    if (!attribute.directive) continue
    const name = attribute.key?.name
    const raw = typeof name === 'string' ? name : name?.name
    if (raw) names.add(raw)
  }
  return names
}

/** A `v-if` chain renders at most one element, so it is not a fragment. */
function isSingleBranchChain(elements: any[]): boolean {
  if (elements.length < 2) return false
  let sawIf = false
  for (const element of elements) {
    const names = directiveNames(element)
    const branch = [...names].find((name) => BRANCH_DIRECTIVES.has(name))
    if (!branch) return false
    if (branch === 'if') {
      if (sawIf) return false
      sawIf = true
    }
  }
  return sawIf
}

function isInheritAttrsFalseProperty(property: any): boolean {
  return (
    property?.type === 'Property' &&
    !property.computed &&
    ((property.key?.type === 'Identifier' && property.key.name === 'inheritAttrs') ||
      (property.key?.type === 'Literal' && property.key.value === 'inheritAttrs')) &&
    property.value?.type === 'Literal' &&
    property.value.value === false
  )
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'disallow fragment, teleport, or text-only component roots without inheritAttrs: false',
      recommended: true,
      url: 'https://vuejs.org/guide/components/attrs.html',
    },
    schema: [],
    messages: {
      fragmentNeedsInheritAttrs:
        'This component renders {{count}} root nodes, so Vue cannot apply fallthrough attributes. Wrap them in a single root element or add `defineOptions({ inheritAttrs: false })`.',
      teleportRootNeedsInheritAttrs:
        'A root-level <{{tag}}> cannot receive fallthrough attributes. Wrap it in a plain element or add `defineOptions({ inheritAttrs: false })`.',
      textOnlyRootNeedsInheritAttrs:
        'This component renders only text at the root, which cannot receive fallthrough attributes. Wrap it in a single root element or add `defineOptions({ inheritAttrs: false })`.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    if (!getFilename(context).endsWith('.vue')) return {}

    let hasInheritAttrsFalse = false

    const scriptVisitor = {
      CallExpression(node: any) {
        const name = node.callee?.type === 'Identifier' ? node.callee.name : null
        if (name !== 'defineOptions' && name !== 'defineComponent') return
        const argument = node.arguments?.[0]
        if (argument?.type !== 'ObjectExpression') return
        if (argument.properties.some(isInheritAttrsFalseProperty)) hasInheritAttrsFalse = true
      },
      ExportDefaultDeclaration(node: any) {
        const declaration = node.declaration
        if (declaration?.type !== 'ObjectExpression') return
        if (declaration.properties.some(isInheritAttrsFalseProperty)) hasInheritAttrsFalse = true
      },
    }

    const templateVisitor = {
      VElement(node: any) {
        if (node.name !== 'template' || node.parent?.type !== 'VDocumentFragment') return
        if (hasInheritAttrsFalse) return

        const roots = (node.children ?? []).filter(
          (child: any) =>
            child.type === 'VElement' || (child.type === 'VText' && child.value.trim().length > 0),
        )
        if (roots.length === 0) return

        const rootElements = roots.filter((child: any) => child.type === 'VElement')

        if (roots.length > 1) {
          if (rootElements.length === roots.length && isSingleBranchChain(rootElements)) return
          context.report({
            node: node.startTag ?? node,
            messageId: 'fragmentNeedsInheritAttrs',
            data: { count: String(roots.length) },
          })
          return
        }

        const [only] = roots
        if (only.type === 'VElement') {
          const tag = String(only.rawName ?? only.name)
          if (UNINHERITABLE_ROOT_TAGS.has(tag.toLowerCase())) {
            context.report({
              node: only.startTag ?? only,
              messageId: 'teleportRootNeedsInheritAttrs',
              data: { tag },
            })
          }
          return
        }

        context.report({ node: node.startTag ?? node, messageId: 'textOnlyRootNeedsInheritAttrs' })
      },
    }

    return templateBodyVisitor(context, templateVisitor, scriptVisitor)
  },
} satisfies Rule.RuleModule
