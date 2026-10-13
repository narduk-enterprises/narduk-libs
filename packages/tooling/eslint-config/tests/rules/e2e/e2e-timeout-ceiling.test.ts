import * as tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../../src/rules/e2e/e2e-timeout-ceiling'

RuleTester.describe = describe
RuleTester.it = it

const ts = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

const SPEC = 'tests/e2e/agents-screen.spec.ts'

ts.run('e2e-timeout-ceiling', rule, {
  valid: [
    // test.setTimeout at and below the default ceiling
    { filename: SPEC, code: 'test.setTimeout(60_000)' },
    { filename: SPEC, code: 'test.setTimeout(5000)' },
    // a per-route budget is not a literal and is left alone
    { filename: SPEC, code: 'test.setTimeout(routes.length * 10_000)' },
    { filename: SPEC, code: 'test.setTimeout(BUDGET)' },
    // another receiver is not Playwright's test
    { filename: SPEC, code: 'jest.setTimeout(150_000)' },
    { filename: SPEC, code: "test['setTimeout'](150_000)" },
    // waits at and below the wait ceiling
    { filename: SPEC, code: 'await page.locator("x").waitFor({ timeout: 30_000 })' },
    { filename: SPEC, code: 'await page.locator("x").waitFor({ timeout: 15_000 })' },
    { filename: SPEC, code: 'await expect(x).toBeVisible({ timeout: BIG })' },
    // an unrelated property with a big number
    { filename: SPEC, code: 'const row = { retryAfter: 120_000 }' },
    // a computed key is not judged
    { filename: SPEC, code: 'const row = { [timeout]: 120_000 }' },
    // setTimeout used for something other than a bare sleep promise
    { filename: SPEC, code: 'new Promise((resolve) => other(resolve, 100))' },
    { filename: SPEC, code: 'new Promise((resolve) => { work(); setTimeout(resolve, 100) })' },
    { filename: SPEC, code: 'new Promise(executor)' },
    { filename: SPEC, code: 'new Thing((resolve) => setTimeout(resolve, 100))' },
    // options raise the ceilings
    {
      filename: SPEC,
      code: 'test.setTimeout(90_000)',
      options: [{ testTimeoutMs: 90_000 }],
    },
    {
      filename: SPEC,
      code: 'await x.waitFor({ timeout: 45_000 })',
      options: [{ waitTimeoutMs: 45_000 }],
    },
  ],
  invalid: [
    // test.setTimeout over the ceiling, by one and by a lot
    {
      filename: SPEC,
      code: 'test.setTimeout(60_001)',
      errors: [{ messageId: 'testTimeout', data: { ms: '60001', ceiling: '60000' } }],
    },
    {
      filename: SPEC,
      code: 'test.setTimeout(150_000)',
      errors: [{ messageId: 'testTimeout', data: { ms: '150000', ceiling: '60000' } }],
    },
    // a wait over the ceiling, in every call that takes { timeout }
    {
      filename: SPEC,
      code: 'await page.locator("x").waitFor({ timeout: 30_001 })',
      errors: [{ messageId: 'waitTimeout', data: { ms: '30001', ceiling: '30000' } }],
    },
    {
      filename: SPEC,
      code: 'await expect(page.locator("x")).toBeVisible({ timeout: 60_000 })',
      errors: [{ messageId: 'waitTimeout' }],
    },
    // a quoted key is the same property
    {
      filename: SPEC,
      code: "await x.waitFor({ 'timeout': 90_000 })",
      errors: [{ messageId: 'waitTimeout' }],
    },
    // the sleep, as an arrow expression, an arrow block and a function
    {
      filename: SPEC,
      code: 'await new Promise((resolve) => setTimeout(resolve, 3_000))',
      errors: [{ messageId: 'sleep' }],
    },
    {
      filename: SPEC,
      code: 'await new Promise(resolve => { setTimeout(resolve, 500) })',
      errors: [{ messageId: 'sleep' }],
    },
    {
      filename: SPEC,
      code: 'await new Promise(function (resolve) { setTimeout(resolve, 500) })',
      errors: [{ messageId: 'sleep' }],
    },
    // options lower the ceilings
    {
      filename: SPEC,
      code: 'test.setTimeout(45_000)',
      options: [{ testTimeoutMs: 30_000 }],
      errors: [{ messageId: 'testTimeout', data: { ms: '45000', ceiling: '30000' } }],
    },
    {
      filename: SPEC,
      code: 'await x.waitFor({ timeout: 20_000 })',
      options: [{ waitTimeoutMs: 10_000 }],
      errors: [{ messageId: 'waitTimeout', data: { ms: '20000', ceiling: '10000' } }],
    },
    // all three forms in one file are three reports
    {
      filename: SPEC,
      code: [
        'test.setTimeout(150_000)',
        'await x.waitFor({ timeout: 60_000 })',
        'await new Promise((r) => setTimeout(r, 10))',
      ].join('\n'),
      errors: [{ messageId: 'testTimeout' }, { messageId: 'waitTimeout' }, { messageId: 'sleep' }],
    },
  ],
})
