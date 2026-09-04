/**
 * Shared internals for the vue/architecture tier.
 *
 * NOT a rule module — files in this directory beginning with `_` are internal
 * helpers and must be excluded from any rule enumeration in `src/index.ts`.
 */

import type { Rule } from 'eslint'

import { inAppScope, isTestOrFixturePath } from '../utils/path-scope'

export { isTestOrFixturePath }

/** See the note on the identical adapter in `hydration/_internal.ts`. */
export function inDir(filename: string, dir: string): boolean {
  return inAppScope(filename, dir)
}

export function getFilename(context: Rule.RuleContext): string {
  return (
    context.filename ??
    (context as unknown as { getFilename?(): string }).getFilename?.() ??
    ''
  ).replaceAll('\\', '/')
}

export const SCRIPT_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/

/** `true` when any enclosing node is a function body. */
export function isInsideFunction(node: any): boolean {
  let current: any = node?.parent
  while (current) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'TSDeclareFunction' ||
      current.type === 'StaticBlock'
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

/** Vue/Nuxt APIs whose presence marks a function as a composable rather than a helper. */
export const REACTIVE_API_NAMES = new Set([
  'ref',
  'shallowRef',
  'customRef',
  'reactive',
  'shallowReactive',
  'computed',
  'watch',
  'watchEffect',
  'watchPostEffect',
  'watchSyncEffect',
  'provide',
  'inject',
  'onMounted',
  'onBeforeMount',
  'onUnmounted',
  'onBeforeUnmount',
  'onUpdated',
  'onBeforeUpdate',
  'onActivated',
  'onDeactivated',
  'onServerPrefetch',
  'onScopeDispose',
  'effectScope',
  'useState',
  'useAsyncData',
  'useLazyAsyncData',
  'useFetch',
  'useLazyFetch',
  'useRoute',
  'useRouter',
  'useNuxtApp',
  'useRuntimeConfig',
  'useCookie',
  'useHead',
  'useSeoMeta',
])

/** Does this function body call any reactivity/lifecycle API directly? */
export function callsReactiveApi(fn: any): boolean {
  let found = false

  const walk = (node: any, depth: number): void => {
    if (found || !node || typeof node !== 'object' || depth > 40) return

    if (node.type === 'CallExpression') {
      const callee = node.callee
      const name =
        callee?.type === 'Identifier'
          ? callee.name
          : callee?.type === 'MemberExpression' &&
              !callee.computed &&
              callee.property?.type === 'Identifier'
            ? callee.property.name
            : null
      if (name && (REACTIVE_API_NAMES.has(name) || /^use[A-Z]/.test(name))) {
        found = true
        return
      }
    }

    for (const key of Object.keys(node)) {
      if (
        key === 'parent' ||
        key === 'loc' ||
        key === 'range' ||
        key === 'tokens' ||
        key === 'comments'
      )
        continue
      const child = (node as any)[key]
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry && typeof entry === 'object' && typeof entry.type === 'string')
            walk(entry, depth + 1)
        }
      } else if (child && typeof child === 'object' && typeof child.type === 'string') {
        walk(child, depth + 1)
      }
    }
  }

  walk(fn?.body, 0)
  return found
}
