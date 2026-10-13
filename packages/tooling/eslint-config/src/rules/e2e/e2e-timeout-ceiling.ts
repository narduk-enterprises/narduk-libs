/**
 * Keep a browser test's time budget near what the test needs.
 *
 * Playwright's own default gives every test 30 s and the median test takes a
 * couple of seconds, so a budget far above the default is a ceiling a hung test
 * burns in full, once per attempt, before anyone reads why. Three forms:
 *
 * - `test.setTimeout(<literal>)` above `testTimeoutMs` (default 60 000);
 * - a `{ timeout: <literal> }` property above `waitTimeoutMs` (default 30 000),
 *   which is a sleep wearing a selector;
 * - `new Promise((resolve) => setTimeout(resolve, n))`, which is
 *   `page.waitForTimeout` spelled so `playwright/no-wait-for-timeout` cannot see
 *   it.
 *
 * Only numeric literals are judged. A test that walks N routes states a budget
 * per route (`routes.length * 10_000`) and is left alone. A spec that genuinely
 * waits out a server window turns the rule off for that file in the app's own
 * flat config; keep that list as an app constant and make it shrink-only.
 *
 * The `e2e` pack applies this to spec and helper files only, never to
 * `playwright.config.*`, where `webServer.timeout` and `globalTimeout` are
 * legitimately large.
 */

import type { Rule } from 'eslint'

export const DEFAULT_TEST_TIMEOUT_CEILING_MS = 60_000
export const DEFAULT_WAIT_TIMEOUT_CEILING_MS = 30_000

const FUNCTION_NODE_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression'])

function numericLiteral(node: any): number | null {
  return node?.type === 'Literal' && typeof node.value === 'number' ? node.value : null
}

/** `test.setTimeout(...)` — the Playwright `test` binding, not another receiver. */
function isTestSetTimeout(node: any): boolean {
  const callee = node.callee
  return (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'test' &&
    callee.property?.type === 'Identifier' &&
    callee.property.name === 'setTimeout'
  )
}

function isBareSetTimeoutCall(node: any): boolean {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'setTimeout'
  )
}

/** The single expression an executor evaluates, `() => expr` or `() => { expr }`. */
function executorExpression(executor: any): any {
  const { body } = executor
  if (
    body.type === 'BlockStatement' &&
    body.body.length === 1 &&
    body.body[0].type === 'ExpressionStatement'
  ) {
    return body.body[0].expression
  }
  return body
}

function propertyName(node: any): string | null {
  if (node.computed) return null
  if (node.key?.type === 'Identifier') return node.key.name
  if (node.key?.type === 'Literal' && typeof node.key.value === 'string') return node.key.value
  return null
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'keep browser-test time budgets near what the test needs: cap literal test.setTimeout and { timeout } values and ban setTimeout sleeps',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          testTimeoutMs: { type: 'number', minimum: 0 },
          waitTimeoutMs: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      testTimeout:
        'test.setTimeout({{ms}}) is over the {{ceiling}} ms ceiling: make the test faster or split it; a test that walks routes states a budget per route.',
      waitTimeout:
        'A {{ms}} ms wait is over the {{ceiling}} ms ceiling: wait for the signal the page gives, not for time.',
      sleep:
        'A setTimeout sleep is page.waitForTimeout in disguise: wait for the response, the locator or the state instead.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as { testTimeoutMs?: number; waitTimeoutMs?: number }
    const testCeiling = options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_CEILING_MS
    const waitCeiling = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_CEILING_MS

    return {
      CallExpression(node: any) {
        if (!isTestSetTimeout(node)) return
        const ms = numericLiteral(node.arguments[0])
        if (ms !== null && ms > testCeiling) {
          context.report({
            node,
            messageId: 'testTimeout',
            data: { ms: String(ms), ceiling: String(testCeiling) },
          })
        }
      },

      NewExpression(node: any) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'Promise') return
        const executor = node.arguments[0]
        if (!executor || !FUNCTION_NODE_TYPES.has(executor.type)) return
        if (isBareSetTimeoutCall(executorExpression(executor))) {
          context.report({ node, messageId: 'sleep' })
        }
      },

      Property(node: any) {
        if (propertyName(node) !== 'timeout') return
        const ms = numericLiteral(node.value)
        if (ms !== null && ms > waitCeiling) {
          context.report({
            node,
            messageId: 'waitTimeout',
            data: { ms: String(ms), ceiling: String(waitCeiling) },
          })
        }
      },
    }
  },
} satisfies Rule.RuleModule
