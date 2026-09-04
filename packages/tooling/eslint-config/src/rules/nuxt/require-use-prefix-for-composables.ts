/**
 * Rule: require-use-prefix-for-composables
 *
 * An exported function in `composables/` that touches reactivity or lifecycle
 * *is* a composable and must be named `useX`, both by convention and because
 * Nuxt auto-imports it under exactly that name.
 *
 * Rewritten from v1, whose deep-review verdict was that a single `use*` export
 * exempted every other export in the file (its `Program:exit` returned early if
 * *any* export was use-prefixed, which also made its `continue` unreachable) and
 * whose `paths` option never applied. Now:
 *
 *  - every exported function is judged on its own;
 *  - only functions that actually call a reactivity/lifecycle/`use*` API are
 *    judged, so a pure helper exported from the same file is not renamed;
 *  - scope comes from the shared, tested `path-scope` util, and the broken
 *    `paths` option is gone.
 */

import type { Rule } from 'eslint'

import { SCRIPT_EXTENSION_PATTERN, getFilename, inDir, isTestOrFixturePath } from './_internal'
import { callsReactiveApi } from '../vue/_internal'

function isFunctionLike(node: any): boolean {
  return (
    node?.type === 'FunctionDeclaration' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'ArrowFunctionExpression'
  )
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'require exported composables to be named with a use prefix',
      recommended: true,
      url: 'https://vuejs.org/guide/reusability/composables.html',
    },
    schema: [],
    messages: {
      requireUsePrefix:
        '`{{name}}` uses reactivity/lifecycle APIs, so it is a composable and should be named `use{{suggested}}` — that is the name Nuxt auto-imports.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (!inDir(filename, 'composables') || !SCRIPT_EXTENSION_PATTERN.test(filename)) return {}

    /** name -> function node, for every function declared in the module. */
    const declaredFunctions = new Map<string, any>()
    /** Exported names that still need a verdict at Program:exit (hoisting-safe). */
    const exported: Array<{ name: string; node: any }> = []

    function trackExport(name: string | null | undefined, node: any) {
      if (!name) return
      exported.push({ name, node })
    }

    return {
      FunctionDeclaration(node: any) {
        if (node.id?.name) declaredFunctions.set(node.id.name, node)
      },
      VariableDeclarator(node: any) {
        if (node.id?.type === 'Identifier' && isFunctionLike(node.init)) {
          declaredFunctions.set(node.id.name, node.init)
        }
      },
      ExportDefaultDeclaration(node: any) {
        const declaration = node.declaration
        if (isFunctionLike(declaration) && declaration.id?.name) {
          trackExport(declaration.id.name, declaration.id)
          return
        }
        if (declaration?.type === 'Identifier') trackExport(declaration.name, declaration)
      },
      ExportNamedDeclaration(node: any) {
        if (node.declaration?.type === 'FunctionDeclaration' && node.declaration.id?.name) {
          trackExport(node.declaration.id.name, node.declaration.id)
          return
        }
        if (node.declaration?.type === 'VariableDeclaration') {
          for (const declarator of node.declaration.declarations ?? []) {
            if (declarator.id?.type === 'Identifier' && isFunctionLike(declarator.init)) {
              trackExport(declarator.id.name, declarator.id)
            }
          }
          return
        }
        for (const specifier of node.specifiers ?? []) {
          if (
            specifier.type === 'ExportSpecifier' &&
            specifier.local?.type === 'Identifier' &&
            specifier.exported?.type === 'Identifier'
          ) {
            trackExport(specifier.exported.name, specifier.exported)
          }
        }
      },
      'Program:exit'() {
        for (const entry of exported) {
          if (entry.name.startsWith('use')) continue
          const fn = declaredFunctions.get(entry.name)
          if (!fn || !callsReactiveApi(fn)) continue

          context.report({
            node: entry.node,
            messageId: 'requireUsePrefix',
            data: {
              name: entry.name,
              suggested: entry.name.charAt(0).toUpperCase() + entry.name.slice(1),
            },
          })
        }
      },
    }
  },
} satisfies Rule.RuleModule
