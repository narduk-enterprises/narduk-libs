/**
 * narduk-libs#902: `vitest run --coverage` writes `coverage/` inside the
 * package, and the next `narduk-lint` linted the generated
 * `coverage/*.js`, failing strict mode on warnings with no budget entry. A
 * second `quality` run on unchanged code failed. Test-output directories are
 * generated, never source, so the shared baseline ignores them.
 *
 * Asserted through ESLint's own resolver, as `narduk-lint` sees the files.
 */

import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

interface AppConfigModule {
  composeSharedConfigs: (...args: unknown[]) => unknown[]
}

let appConfig: AppConfigModule

beforeAll(async () => {
  appConfig = (await import(
    new URL('../../eslint-app-config.mjs', import.meta.url).href
  )) as AppConfigModule
})

function linter(options: { communityLayer?: boolean } = {}): ESLint {
  return new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    baseConfig: appConfig.composeSharedConfigs({ packs: [], ...options }) as never,
  })
}

describe('shared baseline ignores test output', () => {
  it.each([
    'coverage/block-navigation.js',
    'coverage/lcov-report/prettify.js',
    'playwright-report/trace/index.js',
    'test-results/run/attachment.js',
  ])('ignores %s', async (filePath) => {
    expect(await linter().isPathIgnored(filePath)).toBe(true)
    expect(await linter({ communityLayer: false }).isPathIgnored(filePath)).toBe(true)
  })

  // Anchored at the lint root like `dist/**`: an app feature folder named
  // `coverage` (insurance coverage, say) is source and stays linted.
  it('still lints source files that merely mention coverage', async () => {
    expect(await linter().isPathIgnored('src/coverage.ts')).toBe(false)
    expect(await linter().isPathIgnored('app/components/coverage/CoverageCard.ts')).toBe(false)
  })
})
