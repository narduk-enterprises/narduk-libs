/**
 * The `e2e` pack turns `narduk/e2e-timeout-ceiling` on at `warn` for spec and
 * helper files, and never for `playwright.config.*`, where `webServer.timeout`
 * and `globalTimeout` are legitimately above the ceilings. Apps lint at
 * `--max-warnings 0`, so `warn` is enforcing.
 */

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

interface AppConfigModule {
  composeSharedConfigs: (...args: unknown[]) => unknown[]
}

const RULE = 'narduk/e2e-timeout-ceiling'
let eslint: ESLint
let tuned: ESLint

beforeAll(async () => {
  const appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
  const baseConfig = appConfig.composeSharedConfigs('e2e') as never
  eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: true, baseConfig })
  tuned = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    baseConfig,
    overrideConfig: [
      { files: ['tests/e2e/slow.spec.ts'], rules: { [RULE]: 'off' } },
      { files: ['tests/e2e/strict.spec.ts'], rules: { [RULE]: ['warn', { waitTimeoutMs: 5000 }] } },
    ],
  })
}, 60_000)

const SPEC = `import { test } from '@playwright/test'

test('proof', async ({ page }) => {
  test.setTimeout(150_000)
  await page.locator('x').waitFor({ timeout: 20_000 })
})
`

async function ceiling(linter: ESLint, filePath: string, source = SPEC) {
  const [result] = await linter.lintText(source, { filePath })
  return result!.messages.filter((m) => m.ruleId === RULE)
}

describe('e2e pack: narduk/e2e-timeout-ceiling', () => {
  it.each(['tests/e2e/agents.spec.ts', 'e2e/tests/charts.spec.ts', 'tests/e2e/helpers/wait.ts'])(
    'warns on an over-long budget in %s',
    async (filePath) => {
      const found = await ceiling(eslint, filePath)
      expect(found).toHaveLength(1)
      expect(found[0]!.severity).toBe(1)
    },
  )

  it('does not read playwright.config or files outside the e2e trees', async () => {
    const config = `export default { timeout: 30_000, webServer: { timeout: 240_000 }, use: { navigationTimeout: 60_000 }, globalTimeout: 900_000 }\n`
    expect(await ceiling(eslint, 'playwright.config.ts', config)).toEqual([])
    expect(await ceiling(eslint, 'apps/web/playwright.config.ts', config)).toEqual([])
    expect(
      await ceiling(eslint, 'server/api/slow.ts', 'export const x = { timeout: 120_000 }\n'),
    ).toEqual([])
  })

  it('lets an app turn it off per file, or tune the ceilings', async () => {
    expect(await ceiling(tuned, 'tests/e2e/slow.spec.ts')).toEqual([])
    expect(await ceiling(tuned, 'tests/e2e/strict.spec.ts')).toHaveLength(2)
  })
})
