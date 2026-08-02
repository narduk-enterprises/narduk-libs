/**
 * Disallow sub-second `setInterval` (optionally `setTimeout`) delays expressed
 * as numeric literals — hot polling loops that churn the main thread.
 *
 * Deep-review verdict: SOLID / KEEP (10 tests). Ported unchanged apart from the
 * ESLint 10 API surface.
 *
 * Known, tested boundary: the receiver allow-list is literal (`window`,
 * `globalThis`, `self`). A timer reached through an alias — `const g =
 * globalThis; g.setInterval(fn, 100)` — is not reported. That is the review's
 * repo-wide "alias/namespace" weakness class; it is asserted as a `valid` case
 * in the test suite so the boundary is visible rather than assumed, and is not
 * widened here because doing so would change what the rule reports beyond the
 * review's KEEP verdict.
 */

import type { Rule } from 'eslint'

const DEFAULT_MIN_MS = 1000
const TIMER_GLOBALS = new Set(['window', 'globalThis', 'self'])

type TimerName = 'setInterval' | 'setTimeout'

export default {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description:
        'disallow sub-second client timers with numeric literal delays (use a higher interval or a debounced update)',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          minIntervalMs: { type: 'number' },
          includeSetTimeout: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooTight:
        'Timer delay {{ms}}ms is below {{min}}ms. Prefer a longer interval, requestAnimationFrame, or debounced updates to avoid main-thread churn.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as {
      minIntervalMs?: number
      includeSetTimeout?: boolean
    }
    const minIntervalMs =
      typeof options.minIntervalMs === 'number' ? options.minIntervalMs : DEFAULT_MIN_MS
    const includeSetTimeout = options.includeSetTimeout === true

    function isTimerCallee(callee: any, fnName: TimerName): boolean {
      if (callee?.type === 'ChainExpression') {
        return isTimerCallee(callee.expression, fnName)
      }

      if (callee?.type === 'Identifier') {
        return callee.name === fnName
      }

      if (callee?.type !== 'MemberExpression' || callee.computed) {
        return false
      }
      if (callee.property?.type !== 'Identifier' || callee.property.name !== fnName) {
        return false
      }

      return callee.object?.type === 'Identifier' && TIMER_GLOBALS.has(callee.object.name)
    }

    function checkDelayForFn(node: any, fnName: TimerName): void {
      if (!isTimerCallee(node.callee, fnName)) {
        return
      }
      if (node.arguments.length < 2) {
        return
      }
      const delay = node.arguments[1]
      if (delay.type !== 'Literal' || typeof delay.value !== 'number') {
        return
      }
      if (delay.value >= minIntervalMs) {
        return
      }
      context.report({
        node: delay,
        messageId: 'tooTight',
        data: { ms: String(delay.value), min: String(minIntervalMs) },
      })
    }

    return {
      CallExpression(node: any) {
        checkDelayForFn(node, 'setInterval')
        if (includeSetTimeout) {
          checkDelayForFn(node, 'setTimeout')
        }
      },
    }
  },
} satisfies Rule.RuleModule
