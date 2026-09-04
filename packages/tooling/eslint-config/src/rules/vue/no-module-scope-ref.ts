/**
 * Rule: no-module-scope-ref
 *
 * A module-scope `ref()` in a composable or util is created once per *worker*,
 * not once per request, so one visitor's data leaks into the next request's SSR
 * render. Use `useState()` (request-scoped) or create the ref inside the
 * composable.
 *
 * Kept from v1 with its two deep-review misses fixed. v1 only inspected
 * `VariableDeclarator.init`, so `let x; x = ref(0)` and
 * `export const s = { r: ref(0) }` were invisible. Matching the call itself and
 * asking whether any enclosing function exists catches every form.
 */

import type { Rule } from 'eslint'

import { SCRIPT_EXTENSION_PATTERN, getFilename, inDir, isInsideFunction } from './_internal'

const MODULE_SCOPE_UNSAFE = new Set(['ref', 'shallowRef'])

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow module-scope ref() in composables and utils',
      recommended: true,
      url: 'https://nuxt.com/docs/4.x/api/composables/use-state',
    },
    schema: [],
    messages: {
      moduleScopeRef:
        'Module-scope `{{name}}()` is shared by every SSR request on this worker. Use `useState()` or create the ref inside the composable.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    const inScope = inDir(filename, 'composables') || inDir(filename, 'utils')
    if (!inScope || !SCRIPT_EXTENSION_PATTERN.test(filename)) return {}

    return {
      CallExpression(node: any) {
        if (node.callee?.type !== 'Identifier') return
        const name = node.callee.name
        if (!MODULE_SCOPE_UNSAFE.has(name)) return
        if (isInsideFunction(node)) return

        context.report({ node: node.callee, messageId: 'moduleScopeRef', data: { name } })
      },
    }
  },
} satisfies Rule.RuleModule
