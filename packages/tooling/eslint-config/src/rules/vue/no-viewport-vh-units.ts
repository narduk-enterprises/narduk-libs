/**
 * Rule: no-viewport-vh-units
 *
 * Mobile web QA rule 4: `vh` is the LARGE viewport, so on a phone `100vh`
 * puts the bottom of the element behind the browser's toolbar. `dvh` follows
 * the visible viewport and `svh` is the smallest one. The `design-system` pack
 * already bans `h-screen` and `[…vh]` Tailwind classes; this covers the same
 * unit written into an inline style.
 *
 *   flagged   <div style="height: 100vh">
 *             <div :style="{ minHeight: '100vh' }">
 *             <div :style="`max-height: calc(${n}vh - 4rem)`">
 *
 *   allowed   <div style="height: 100dvh">        — and svh, lvh
 *             <div :style="{ height: h }">         — not a literal
 *
 * Only `style` attributes and `:style` bindings in templates are read; `<style>`
 * blocks and `.css` files belong to stylelint.
 */

import type { Rule } from 'eslint'

import { templateBodyVisitor } from '../hydration/_internal'

/** A number immediately followed by `vh` and no further letter (`100dvh` has one between). */
const VH_UNIT = /(?:\d|\})vh\b/i

/** Literals in positions that become style, never in a test or a comparison. */
function literalTexts(expression: any, out: string[] = []): string[] {
  if (!expression || typeof expression !== 'object') return out
  switch (expression.type) {
    case 'Literal':
      if (typeof expression.value === 'string') out.push(expression.value)
      break
    case 'TemplateLiteral':
      // Join the quasis with a marker that keeps `${n}vh` detectable.
      out.push(expression.quasis.map((quasi: any) => quasi.value.cooked ?? '').join('}'))
      for (const inner of expression.expressions) literalTexts(inner, out)
      break
    case 'ConditionalExpression':
      literalTexts(expression.consequent, out)
      literalTexts(expression.alternate, out)
      break
    case 'LogicalExpression':
      if (expression.operator !== '&&') literalTexts(expression.left, out)
      literalTexts(expression.right, out)
      break
    case 'ArrayExpression':
      for (const element of expression.elements) literalTexts(element, out)
      break
    case 'ObjectExpression':
      for (const property of expression.properties)
        literalTexts(property.type === 'SpreadElement' ? property.argument : property.value, out)
      break
    case 'ChainExpression':
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      literalTexts(expression.expression, out)
      break
    default:
  }
  return out
}

export default {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description: 'disallow `vh` units in inline styles; use `dvh` or `svh`',
      recommended: true,
    },
    schema: [],
    messages: {
      vhUnit:
        "Use `dvh` or `svh`, not `vh`: `vh` is the large viewport, so a phone's browser chrome covers the bottom of this element (mobile web QA rule 4).",
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    return templateBodyVisitor(context, {
      VAttribute(node: any) {
        if (!node.directive) {
          if (node.key.name === 'style' && VH_UNIT.test(node.value?.value ?? '')) {
            context.report({ node, messageId: 'vhUnit' })
          }
          return
        }
        if (node.key.name?.name !== 'bind' || node.key.argument?.name !== 'style') return
        if (literalTexts(node.value?.expression).some((text) => VH_UNIT.test(text))) {
          context.report({ node, messageId: 'vhUnit' })
        }
      },
    })
  },
} satisfies Rule.RuleModule
