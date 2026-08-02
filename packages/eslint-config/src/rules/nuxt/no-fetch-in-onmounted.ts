/**
 * Rule: no-fetch-in-onmounted
 *
 * `useFetch`/`useAsyncData` inside `onMounted()` never run on the server, so the
 * page ships an empty shell and refetches on the client — and Nuxt warns that
 * the composable was called outside a setup context. Call it during setup, with
 * `{ server: false }` or `useLazyFetch` if you want it client-only.
 *
 * Kept from v1 with its performance and precision defects fixed:
 *
 *  - v1 computed `hookName` but never used it to short-circuit, so *every*
 *    `f(cb)` call in the file triggered a scope walk plus an unbounded subtree
 *    walk. The hook name is now checked first;
 *  - the callee had to be an identifier, so `emitter.onMounted(cb)` no longer
 *    matches;
 *  - the search no longer descends into functions nested inside the hook
 *    callback, where a fetch is a legitimate deferred action.
 */

import type { Rule } from 'eslint'

import { calleeName, bareCalleeName, getFilename, isTestOrFixturePath } from './_internal'

const CLIENT_MOUNT_HOOKS = new Set(['onMounted', 'onBeforeMount'])

const SETUP_ONLY_FETCHERS = new Set([
  'useFetch',
  'useLazyFetch',
  'useAsyncData',
  'useLazyAsyncData',
])

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow useFetch/useAsyncData inside onMounted',
      recommended: true,
      url: 'https://nuxt.com/docs/api/composables/use-async-data',
    },
    schema: [],
    messages: {
      fetchInOnMounted:
        '`{{name}}()` inside {{hook}}() never runs on the server and warns about being called outside a setup context. Call it during setup — use `{ server: false }` or useLazy*() for client-only loading.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}

    /** Walks a hook callback body without entering functions nested inside it. */
    function findSetupOnlyFetch(
      node: any,
      depth: number,
      onFound: (found: any, name: string) => void,
    ): void {
      if (!node || typeof node !== 'object' || depth > 40) return

      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        return
      }

      if (node.type === 'CallExpression') {
        const name = calleeName(node.callee)
        if (name && SETUP_ONLY_FETCHERS.has(name)) onFound(node, name)
      }

      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue
        const child = (node as any)[key]
        if (Array.isArray(child)) {
          for (const entry of child) {
            if (entry && typeof entry === 'object' && typeof entry.type === 'string') {
              findSetupOnlyFetch(entry, depth + 1, onFound)
            }
          }
        } else if (child && typeof child === 'object' && typeof child.type === 'string') {
          findSetupOnlyFetch(child, depth + 1, onFound)
        }
      }
    }

    return {
      CallExpression(node: any) {
        const hook = bareCalleeName(node.callee)
        if (!hook || !CLIENT_MOUNT_HOOKS.has(hook)) return

        const callback = node.arguments?.[0]
        if (callback?.type !== 'ArrowFunctionExpression' && callback?.type !== 'FunctionExpression')
          return

        findSetupOnlyFetch(callback.body, 0, (found, name) => {
          context.report({ node: found, messageId: 'fetchInOnMounted', data: { name, hook } })
        })
      },
    }
  },
} satisfies Rule.RuleModule
