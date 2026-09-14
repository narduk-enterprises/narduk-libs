/**
 * Disallow multi-statement inline event handlers in Vue templates.
 *
 * `@click="a(); b()"` compiles, but it hides control flow in markup and is the
 * shape that most often trips the template compiler once a `?.` or an `await`
 * is added later. Extract a named function in `<script setup>`.
 *
 * Deep-review verdict: SOLID / KEEP — but it was the one rule in its row with
 * **zero** tests, so the entire suite here is new. Ported from `.mjs` to
 * TypeScript, on the ESLint 10 API surface.
 *
 * The shared `defineTemplateBodyVisitor` helper is inlined: v1 had two
 * byte-identical copies of it (`src/utils/utils.mjs` and
 * `src/rules/utils.mjs`) and DESIGN.md drops the dead twin, so this three-line
 * accessor is not worth a cross-tier import.
 *
 * Known, tested boundary: only a `VOnExpression` with more than one statement
 * reports. `@click="() => { a(); b() }"` parses as an ArrowFunctionExpression
 * inside a `VExpressionContainer`, not a `VOnExpression`, and is not reported —
 * that form is already an explicit function, which is what the rule asks for.
 */

import type { Rule } from 'eslint'

function defineTemplateBodyVisitor(
  context: Rule.RuleContext,
  templateVisitor: Record<string, (node: any) => void>,
): Rule.RuleListener {
  const parserServices = context.sourceCode?.parserServices as any
  if (typeof parserServices?.defineTemplateBodyVisitor === 'function') {
    return parserServices.defineTemplateBodyVisitor(templateVisitor) as Rule.RuleListener
  }
  // Not a Vue file, or vue-eslint-parser is not in play.
  return {}
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow multi-statement inline event handlers in Vue templates',
      recommended: true,
    },
    schema: [],
    messages: {
      noMultiStatement:
        'Avoid multi-statement inline event handlers. Extract the logic into a named function in the <script> block for better readability and to avoid template compiler errors.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    if (!context.filename.endsWith('.vue')) {
      return {}
    }

    return defineTemplateBodyVisitor(context, {
      'VDirectiveKey[name.name="on"]'(node: any) {
        const attribute = node.parent
        const value = attribute?.value
        if (value?.type !== 'VExpressionContainer' || !value.expression) {
          return
        }

        const expression = value.expression
        if (expression.type !== 'VOnExpression') {
          return
        }

        if (expression.body.length > 1) {
          context.report({
            node: value,
            messageId: 'noMultiStatement',
          })
        }
      },
    })
  },
} satisfies Rule.RuleModule
