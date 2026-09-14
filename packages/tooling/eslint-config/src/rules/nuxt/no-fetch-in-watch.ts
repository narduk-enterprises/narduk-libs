/**
 * Rule: no-fetch-in-watch
 *
 * Refetching from inside a `watch()` callback duplicates what `useAsyncData`
 * already does: its own `watch` option re-runs the handler, keeps `pending`/`error`
 * correct, and cancels the in-flight request. A hand-rolled watcher races.
 *
 * Kept from v1 with the two deep-review defects fixed:
 *
 *  - v1 matched *any* callee named `watch`, including `chokidar.watch(…)` and
 *    `fs.watch(…)` in build scripts. Only a bare, unqualified identifier callee
 *    matches now;
 *  - v1 walked through closure boundaries, so a fetch inside a debounced callback
 *    created within the watcher was attributed to the watcher itself.
 */

import type { Rule } from 'eslint'

import { bareCalleeName, calleeName, getFilename, isTestOrFixturePath } from './_internal'

const WATCH_APIS = new Set(['watch', 'watchEffect', 'watchPostEffect', 'watchSyncEffect'])

const WATCHED_FETCHERS = new Set([
  'useFetch',
  'useLazyFetch',
  'useAsyncData',
  'useLazyAsyncData',
  '$fetch',
])

/** The callback argument index for each watch API. */
function callbackIndex(watchName: string): number {
  return watchName === 'watch' ? 1 : 0
}

/** `watch(src, { handler() {} })` / `watchEffect({ handler() {} })`. */
function optionsHandler(argument: any): any {
  if (argument?.type !== 'ObjectExpression') return null
  for (const property of argument.properties ?? []) {
    if (
      property.type === 'Property' &&
      !property.computed &&
      property.key?.type === 'Identifier' &&
      property.key.name === 'handler' &&
      (property.value?.type === 'ArrowFunctionExpression' ||
        property.value?.type === 'FunctionExpression')
    ) {
      return property.value
    }
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow data fetching inside watch callbacks — use the watch option on useAsyncData',
      recommended: true,
      url: 'https://nuxt.com/docs/api/composables/use-async-data',
    },
    schema: [],
    messages: {
      fetchInWatch:
        '`{{name}}()` inside {{watchName}}() races with itself and loses pending/error state. Pass the reactive source to the `watch` option of useAsyncData()/useFetch() instead.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename)) return {}

    /** Walks the watcher callback body, stopping at any nested function boundary. */
    function findFetch(
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
        if (name && WATCHED_FETCHERS.has(name)) onFound(node, name)
      }

      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'loc' || key === 'range') continue
        const child = (node as any)[key]
        if (Array.isArray(child)) {
          for (const entry of child) {
            if (entry && typeof entry === 'object' && typeof entry.type === 'string') {
              findFetch(entry, depth + 1, onFound)
            }
          }
        } else if (child && typeof child === 'object' && typeof child.type === 'string') {
          findFetch(child, depth + 1, onFound)
        }
      }
    }

    return {
      CallExpression(node: any) {
        // Receiver-aware: `chokidar.watch(…)` / `fs.watch(…)` are not Vue watchers.
        const watchName = bareCalleeName(node.callee)
        if (!watchName || !WATCH_APIS.has(watchName)) return

        const argument = node.arguments?.[callbackIndex(watchName)]
        const callback =
          argument?.type === 'ArrowFunctionExpression' || argument?.type === 'FunctionExpression'
            ? argument
            : optionsHandler(argument)
        if (!callback) return

        findFetch(callback.body, 0, (found, name) => {
          context.report({ node: found, messageId: 'fetchInWatch', data: { name, watchName } })
        })
      },
    }
  },
} satisfies Rule.RuleModule
