/**
 * Rule: no-composable-conditional-hooks
 *
 * Reactivity and lifecycle APIs must be called unconditionally in a composable:
 * a `watch` created inside a branch or a loop is registered against whatever
 * effect scope happens to be active, and cleanup no longer matches creation.
 *
 * Two deep-review defects are fixed:
 *
 *  - v1 treated `unref`, `isRef`, `toValue`, `isReactive`, `isReadonly` and
 *    `isProxy` as order-sensitive hooks, so the canonical
 *    `isRef(src) ? src.value : src` reported. Those are pure predicates and are
 *    no longer listed.
 *  - v1 covered `for`/`while` but missed `ForOfStatement`/`ForInStatement` —
 *    the loop form that actually leaks watchers.
 */

import type { Rule } from 'eslint'

import { getFilename, inDir } from './_internal'

/**
 * Calls that create reactive state, effects, or lifecycle registrations. Pure
 * inspection helpers (`unref`/`isRef`/`toValue`/…) are deliberately absent.
 */
const ORDER_SENSITIVE_APIS = new Set([
  'ref',
  'shallowRef',
  'customRef',
  'reactive',
  'shallowReactive',
  'readonly',
  'shallowReadonly',
  'computed',
  'watch',
  'watchEffect',
  'watchPostEffect',
  'watchSyncEffect',
  'toRef',
  'toRefs',
  'provide',
  'inject',
  'effectScope',
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
  'useState',
  'useAsyncData',
  'useLazyAsyncData',
  'useFetch',
  'useLazyFetch',
])

const CONDITIONAL_NODES = new Set([
  'IfStatement',
  'SwitchStatement',
  'ConditionalExpression',
  'LogicalExpression',
])

const LOOP_NODES = new Set([
  'ForStatement',
  'ForOfStatement',
  'ForInStatement',
  'WhileStatement',
  'DoWhileStatement',
])

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow conditional or looped calls to reactivity/lifecycle APIs in composables',
      recommended: true,
      url: 'https://vuejs.org/guide/reusability/composables.html',
    },
    schema: [],
    messages: {
      conditionalHook:
        '`{{name}}()` must be called unconditionally in a composable — this call sits inside {{context}}, so registration order changes between calls.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    if (!inDir(getFilename(context), 'composables')) return {}

    return {
      CallExpression(node: any) {
        if (node.callee?.type !== 'Identifier') return
        const name = node.callee.name
        if (!ORDER_SENSITIVE_APIS.has(name)) return

        let child: any = node
        let parent: any = node.parent

        while (parent) {
          if (LOOP_NODES.has(parent.type)) {
            context.report({
              node,
              messageId: 'conditionalHook',
              data: { name, context: 'a loop' },
            })
            return
          }

          if (CONDITIONAL_NODES.has(parent.type)) {
            // `cond && watch(...)` short-circuits; `watch(...) && cond` does not.
            const isUnconditionalOperand =
              parent.type === 'LogicalExpression' && child === parent.left
            // The discriminant of a switch always evaluates.
            const isDiscriminant =
              parent.type === 'SwitchStatement' && child === parent.discriminant
            // `if (…) {}` — the test itself always runs.
            const isIfTest = parent.type === 'IfStatement' && child === parent.test
            const isTernaryTest = parent.type === 'ConditionalExpression' && child === parent.test

            if (!isUnconditionalOperand && !isDiscriminant && !isIfTest && !isTernaryTest) {
              context.report({
                node,
                messageId: 'conditionalHook',
                data: { name, context: 'a conditional branch' },
              })
              return
            }
          }

          if (
            parent.type === 'FunctionDeclaration' ||
            parent.type === 'FunctionExpression' ||
            parent.type === 'ArrowFunctionExpression'
          ) {
            return
          }

          child = parent
          parent = parent.parent
        }
      },
    }
  },
} satisfies Rule.RuleModule
