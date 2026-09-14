import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import {
  CONFORMANT_REALITY,
  makeTempRepo,
  subCheckStatus,
  writeConformantBaseline,
  writeFile,
  writeJson,
} from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

async function run(root: string) {
  return runFoundationCheck({
    root,
    toolVersion: '0.0.0-test',
    reality: CONFORMANT_REALITY,
    appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
  })
}

describe('item 5 -- shared CI', () => {
  it('5.1 is unknown with no workflow at all, fails an unpinned callable, passes once pinned', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/.github/workflows/ci.yml`, { force: true })
    expect(subCheckStatus(await run(root), '5.1')).toBe('unknown')

    writeFile(
      root,
      '.github/workflows/ci.yml',
      [
        'name: ci',
        'jobs:',
        '  build:',
        '    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@main',
      ].join('\n'),
    )
    expect(subCheckStatus(await run(root), '5.1')).toBe('fail')

    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '5.1')).toBe('pass')
  })

  it('5.1 also accepts a full 40-char SHA pin', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeFile(
      root,
      '.github/workflows/ci.yml',
      [
        'name: ci',
        'jobs:',
        '  build:',
        `    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@${'a'.repeat(40)}`,
      ].join('\n'),
    )
    expect(subCheckStatus(await run(root), '5.1')).toBe('pass')
  })

  it('5.2 fails with no renovate.json, and once present without the estate scope; passes once named', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/renovate.json`, { force: true })
    expect(subCheckStatus(await run(root), '5.2')).toBe('fail')

    writeJson(root, 'renovate.json', { packageRules: [{ matchPackagePrefixes: ['left-pad'] }] })
    expect(subCheckStatus(await run(root), '5.2')).toBe('fail')

    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '5.2')).toBe('pass')
  })

  it('5.2 accepts a grouping .github/dependabot.yml with no renovate.json (D-TOOLCHAIN-1, narduk-libs#233)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/renovate.json`, { force: true })
    expect(subCheckStatus(await run(root), '5.2')).toBe('fail')

    writeFile(
      root,
      '.github/dependabot.yml',
      [
        'version: 2',
        'updates:',
        '  - package-ecosystem: "npm"',
        '    directory: "/"',
        '    schedule:',
        '      interval: "weekly"',
        '    groups:',
        '      narduk-internal:',
        '        patterns:',
        '          - "@narduk-enterprises/*"',
      ].join('\n'),
    )
    expect(subCheckStatus(await run(root), '5.2')).toBe('pass')
  })

  it('5.2 accepts a delegating (ignore) .github/dependabot.yml with no renovate.json', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/renovate.json`, { force: true })

    writeFile(
      root,
      '.github/dependabot.yml',
      [
        'version: 2',
        'updates:',
        '  - package-ecosystem: "npm"',
        '    directory: "/"',
        '    schedule:',
        '      interval: "weekly"',
        '    ignore:',
        '      - dependency-name: "@narduk-enterprises/*"',
      ].join('\n'),
    )
    expect(subCheckStatus(await run(root), '5.2')).toBe('pass')
  })

  it('5.2 fails (not throws) on invalid YAML in .github/dependabot.yml, with no renovate.json', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/renovate.json`, { force: true })

    writeFile(root, '.github/dependabot.yml', 'updates: [\n  - this is not: valid: yaml')
    expect(subCheckStatus(await run(root), '5.2')).toBe('fail')
  })

  it('5.2 fails a .github/dependabot.yml that never names the estate scope, with no renovate.json', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/renovate.json`, { force: true })

    writeFile(
      root,
      '.github/dependabot.yml',
      [
        'version: 2',
        'updates:',
        '  - package-ecosystem: "npm"',
        '    directory: "/"',
        '    schedule:',
        '      interval: "weekly"',
      ].join('\n'),
    )
    expect(subCheckStatus(await run(root), '5.2')).toBe('fail')
  })
})
