import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { allowVueWarning, installVueWarnGuard } from '../src/vue-warn-guard'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(packageRoot, 'tests/fixtures/vue-warn-guard')

/** Run the fixture project in a real Vitest and return its report. */
function runFixture(env: Record<string, string> = {}, name?: string) {
  const result = spawnSync(
    process.execPath,
    [
      join(packageRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      join(fixture, 'vitest.config.ts'),
      '--reporter=json',
      ...(name ? ['-t', name] : []),
    ],
    {
      cwd: fixture,
      encoding: 'utf8',
      // The agent runner swaps the reporter for one that hides console output.
      env: { ...process.env, AI_AGENT: '', ...env },
    },
  )
  const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as {
    testResults: Array<{
      assertionResults: Array<{ title: string; status: string; failureMessages: string[] }>
    }>
  }
  const tests = json.testResults.flatMap((file) => file.assertionResults)
  return Object.fromEntries(tests.map((test) => [test.title, test]))
}

describe('installVueWarnGuard', () => {
  it('fails the test a Vue warning came from, and only that test', () => {
    const tests = runFixture()
    expect(tests['warns without allowing it']!.status).toBe('failed')
    expect(tests['warns without allowing it']!.failureMessages.join('\n')).toMatch(
      /Vue warned 1 time\(s\) during this test[\s\S]*Failed to resolve component: Nope/,
    )
    expect(tests['is clean']!.status).toBe('passed')
  })

  it('allows a warning for one test and drops the allowance afterwards', () => {
    const tests = runFixture()
    expect(tests['allows the warning for this test only']!.status).toBe('passed')
    expect(tests['does not inherit the previous test allowance']!.status).toBe('failed')
  })

  it('lets a suite-wide allowance with a reason through', () => {
    const tests = runFixture({ FIXTURE_SUITE_ALLOW: '1' })
    expect(Object.values(tests).map((test) => test.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
    ])
  })

  it('refuses a suite allowance with no reason, before touching console', () => {
    const warn = console.warn
    expect(() => installVueWarnGuard({ allow: [{ match: /x/, reason: '' }] })).toThrow(
      /needs a reason/,
    )
    expect(console.warn).toBe(warn)
  })

  it('refuses a per-test allowance when the guard is not installed', () => {
    expect(() => allowVueWarning(/x/, 'a perfectly good reason')).toThrow(
      /needs installVueWarnGuard/,
    )
  })
})
