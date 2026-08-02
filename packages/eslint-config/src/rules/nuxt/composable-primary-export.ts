/**
 * Rule: composable-primary-export
 *
 * A composable file's auto-import name comes from its filename, so
 * `useCart.ts` must export `useCart` — and exporting a second composable from
 * the same file hides it from that convention.
 *
 * Kept from v1 with the two deep-review defects fixed:
 *
 *  - function declarations hoist, so `export default useCart` written *above*
 *    `function useCart() {}` was invisible to v1's during-traversal lookup.
 *    Declarations and exports are now correlated at `Program:exit`;
 *  - `index.ts` was told to rename its export to `index`. Index files are barrels
 *    and are exempt.
 */

import { basename, extname } from 'node:path'

import type { Rule } from 'eslint'

import { SCRIPT_EXTENSION_PATTERN, getFilename, inDir, isTestOrFixturePath } from './_internal'

function isFunctionLike(node: any): boolean {
  return (
    node?.type === 'FunctionDeclaration' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'ArrowFunctionExpression'
  )
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'require one primary composable export whose name matches the filename',
      recommended: true,
      url: 'https://nuxt.com/docs/guide/directory-structure/composables',
    },
    schema: [],
    messages: {
      singlePrimaryExport:
        'A composable file should export one composable. Move `{{name}}` into its own file so Nuxt can auto-import it by name.',
      composableNameMatchesFile:
        'The primary composable export should be named `{{expectedName}}` to match this file, which is the name Nuxt auto-imports.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}
    if (!inDir(filename, 'composables') || filename.includes('/helpers/')) return {}
    if (!SCRIPT_EXTENSION_PATTERN.test(filename) || filename.endsWith('.d.ts')) return {}

    const expectedName = basename(filename, extname(filename))
    if (expectedName === 'index') return {}

    /** Names declared anywhere in the module — collected before any verdict (hoisting). */
    const declaredFunctionNames = new Set<string>()
    /** Exported composable candidates, resolved at Program:exit. */
    const exportCandidates: Array<{ name: string; node: any; requiresDeclaration: boolean }> = []

    function trackExport(name: string | null | undefined, node: any, requiresDeclaration = false) {
      if (!name || !name.startsWith('use')) return
      exportCandidates.push({ name, node, requiresDeclaration })
    }

    return {
      FunctionDeclaration(node: any) {
        if (node.id?.name) declaredFunctionNames.add(node.id.name)
      },
      VariableDeclarator(node: any) {
        if (node.id?.type === 'Identifier' && isFunctionLike(node.init))
          declaredFunctionNames.add(node.id.name)
      },
      ExportDefaultDeclaration(node: any) {
        const declaration = node.declaration
        if (isFunctionLike(declaration) && declaration.id?.name) {
          trackExport(declaration.id.name, declaration.id)
          return
        }
        if (declaration?.type === 'Identifier') {
          trackExport(declaration.name, declaration, true)
        }
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
            trackExport(specifier.exported.name, specifier.exported, true)
          }
        }
      },
      'Program:exit'() {
        const resolved = exportCandidates.filter(
          (candidate) =>
            !candidate.requiresDeclaration || declaredFunctionNames.has(candidate.name),
        )
        if (resolved.length === 0) return

        if (resolved.length > 1) {
          for (const extra of resolved.slice(1)) {
            context.report({
              node: extra.node,
              messageId: 'singlePrimaryExport',
              data: { name: extra.name },
            })
          }
          return
        }

        const [primary] = resolved
        if (primary.name !== expectedName) {
          context.report({
            node: primary.node,
            messageId: 'composableNameMatchesFile',
            data: { expectedName },
          })
        }
      },
    }
  },
} satisfies Rule.RuleModule
