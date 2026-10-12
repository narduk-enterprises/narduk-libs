import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(packageRoot, 'tests/fixtures/vue-strict')

/** Run the fixture project in a real Vitest and return its report. */
function runFixture(env: Record<string, string> = {}) {
  const result = spawnSync(
    process.execPath,
    [
      join(packageRoot, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      join(fixture, 'vitest.config.ts'),
      '--reporter=json',
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

const status = (tests: ReturnType<typeof runFixture>) =>
  Object.fromEntries(Object.entries(tests).map(([title, test]) => [title, test.status]))

describe('vue-strict setup', () => {
  it('fails a component with an unresolved child or a bad prop, and passes the rest', () => {
    const tests = runFixture()
    expect(status(tests)).toEqual({
      'unresolved child': 'failed',
      'bad prop': 'failed',
      'wrong prop type': 'failed',
      'good prop': 'passed',
      'stubbed Nuxt UI component': 'passed',
      'stubbed app component': 'failed',
      'NuxtLink keeps href and slot': 'passed',
      'ClientOnly and NuxtImg': 'passed',
      'a real component beats the pattern stub': 'passed',
      'expects a warning that fires': 'passed',
      'expects a warning that never fires': 'failed',
      'is clean afterwards': 'passed',
    })
    expect(tests['unresolved child']!.failureMessages.join('\n')).toMatch(
      /Vue warned \d+ time\(s\) during this test[\s\S]*Failed to resolve component: KitTile/,
    )
    expect(tests['bad prop']!.failureMessages.join('\n')).toMatch(/Missing required prop/)
    expect(tests['wrong prop type']!.failureMessages.join('\n')).toMatch(/Invalid prop/)
    expect(tests['expects a warning that never fires']!.failureMessages.join('\n')).toMatch(
      /Expected Vue to warn with a message matching/,
    )
  })

  it('stubs an app component by name', () => {
    const tests = runFixture({ FIXTURE_STUB_KIT: '1' })
    expect(tests['unresolved child']!.status).toBe('passed')
    expect(tests['stubbed app component']!.status).toBe('passed')
  })

  it('leaves Nuxt UI components unresolved when ui is false', () => {
    const tests = runFixture({ FIXTURE_NO_UI: '1' })
    expect(tests['stubbed Nuxt UI component']!.status).toBe('failed')
    expect(tests['stubbed Nuxt UI component']!.failureMessages.join('\n')).toMatch(
      /Failed to resolve component: UButton/,
    )
  })

  it('ships a zero-config entry that behaves the same', () => {
    const tests = runFixture({ FIXTURE_ENTRY: 'default' })
    expect(tests['stubbed Nuxt UI component']!.status).toBe('passed')
    expect(tests['bad prop']!.status).toBe('failed')
  })
})
