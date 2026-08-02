/**
 * Rule: no-setup-top-level-side-effects
 *
 * The top level of `<script setup>` runs on the server for every request.
 * Timers, listeners, raw `fetch()` and DOM reads there either throw during SSR
 * or leak per-request state.
 *
 * Kept from v1 with its one deep-review defect fixed: `window.addEventListener(…)`
 * matched both the "addEventListener" branch and the "DOM access" branch and was
 * reported twice. DOM member expressions in callee position are now left to the
 * call-expression branch, so every construct reports exactly once.
 */

import type { Rule } from 'eslint'

import { getFilename, isInsideFunction } from './_internal'
import {
  DOM_GLOBALS,
  isSsrGuarded,
  isUnshadowedGlobal,
  templateBodyVisitor,
} from '../hydration/_internal'

const TIMER_FUNCTIONS = new Set(['setInterval', 'setTimeout'])

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow top-level side effects in <script setup>',
      recommended: true,
      url: 'https://vuejs.org/guide/scaling-up/ssr.html',
    },
    schema: [],
    messages: {
      noTopLevelSideEffect:
        'Top-level side effects in <script setup> run during SSR. Move this into onMounted() or an event handler.',
      useNuxtComposable:
        'Raw fetch() at the top level of <script setup> double-fetches and breaks hydration. Use useAsyncData() or useFetch().',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    if (!getFilename(context).endsWith('.vue')) return {}

    /** The DOM global a member expression reads from, if any. */
    function domReceiverName(node: any): string | null {
      const object = node?.object
      if (object?.type !== 'Identifier' || !DOM_GLOBALS.has(object.name)) return null
      return isUnshadowedGlobal(context, node, object.name) ? object.name : null
    }

    function isRelevant(node: any): boolean {
      return !isInsideFunction(node) && !isSsrGuarded(node)
    }

    const scriptVisitor = {
      CallExpression(node: any) {
        if (!isRelevant(node)) return

        const callee = node.callee

        if (callee?.type === 'Identifier') {
          if (callee.name === 'fetch') {
            context.report({ node, messageId: 'useNuxtComposable' })
            return
          }
          if (TIMER_FUNCTIONS.has(callee.name)) {
            context.report({ node, messageId: 'noTopLevelSideEffect' })
          }
          return
        }

        if (callee?.type !== 'MemberExpression' || callee.computed) return

        if (callee.property?.type === 'Identifier' && callee.property.name === 'addEventListener') {
          context.report({ node, messageId: 'noTopLevelSideEffect' })
          return
        }

        // `localStorage.getItem(…)` — reported here rather than by the member
        // branch so the call reports exactly once.
        if (domReceiverName(callee)) {
          context.report({ node, messageId: 'noTopLevelSideEffect' })
        }
      },

      MemberExpression(node: any) {
        if (!isRelevant(node)) return
        // Callee position is handled by CallExpression above.
        if (node.parent?.type === 'CallExpression' && node.parent.callee === node) return
        if (!domReceiverName(node)) return
        context.report({ node, messageId: 'noTopLevelSideEffect' })
      },
    }

    return templateBodyVisitor(context, {}, scriptVisitor)
  },
} satisfies Rule.RuleModule
