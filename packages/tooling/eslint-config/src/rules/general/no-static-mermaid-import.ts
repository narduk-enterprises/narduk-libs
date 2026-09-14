/**
 * Disallow static `import` of the `mermaid` package.
 *
 * Mermaid is a very large dependency; a static import pulls the whole parser
 * into the entry chunk. Use `await import('mermaid')` on an async path (or a
 * lazy component) instead.
 *
 * Deep-review verdict: SOLID / KEEP (6 tests). Ported unchanged apart from the
 * ESLint 10 API surface and the removal of the stale `docs.url`, which pointed
 * at the demoted `narduk-eslint-config` repository.
 *
 * Known, tested boundaries (documented in the test suite rather than silently
 * widened — widening what the rule reports is out of scope for a KEEP port):
 *  - only the exact specifier `'mermaid'` matches; subpath specifiers such as
 *    `'mermaid/dist/mermaid.esm.mjs'` are not reported.
 *  - `export { default } from 'mermaid'` is a static re-export and is likewise
 *    not reported.
 */

import type { Rule } from 'eslint'

function isTypeOnlyImport(node: any): boolean {
  return (
    node.importKind === 'type' ||
    (node.specifiers.length > 0 &&
      node.specifiers.every((specifier: any) => specifier.importKind === 'type'))
  )
}

export default {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description: 'disallow static imports of the mermaid package; use dynamic import() instead',
      recommended: true,
    },
    schema: [],
    messages: {
      useDynamicImport:
        "Avoid static `import` of `mermaid` (large bundle). Use `const m = await import('mermaid')` in an async path or a lazy component instead.",
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      ImportDeclaration(node: any) {
        const src = node.source
        if (src?.type !== 'Literal' || src.value !== 'mermaid') {
          return
        }
        if (isTypeOnlyImport(node)) {
          return
        }
        context.report({ node, messageId: 'useDynamicImport' })
      },
    }
  },
} satisfies Rule.RuleModule
