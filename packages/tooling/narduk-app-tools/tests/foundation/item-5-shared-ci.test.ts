import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import { evaluateDependabotStackingShape } from '../../src/foundation/items/item-5-shared-ci.js'
import { AppRepo } from '../../src/foundation/source.js'
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

  it('5.2 accepts the canonical recipe: an ungrouped npm update through a registry scoped to the estate (narduk-libs#241)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/renovate.json`, { force: true })

    writeFile(
      root,
      '.github/dependabot.yml',
      [
        'version: 2',
        'registries:',
        '  narduk-packages:',
        '    type: npm-registry',
        '    url: https://npm.pkg.github.com',
        '    token: ${{ secrets.NARDUK_PLATFORM_GH_PACKAGES_READ }}',
        '    scope: "@narduk-enterprises"',
        'updates:',
        '  - package-ecosystem: "npm"',
        '    directory: "/"',
        '    registries:',
        '      - narduk-packages',
        '    schedule:',
        '      interval: "weekly"',
      ].join('\n'),
    )
    expect(subCheckStatus(await run(root), '5.2')).toBe('pass')
  })
})

// Advisory-only stacking-shape check (narduk-libs#U2, gonogo#104). Not a
// FoundationSubCheck -- see evaluateDependabotStackingShape's doc comment --
// so it is exercised directly rather than through subCheckStatus/run().
describe('dependabot stacking-shape advisory (not a foundation sub-check)', () => {
  it('is null for the two-lane safe/majors shape', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeFile(
      root,
      '.github/dependabot.yml',
      [
        'version: 2',
        'updates:',
        '  - package-ecosystem: "npm"',
        '    directory: "/"',
        '    open-pull-requests-limit: 2',
        '    groups:',
        '      safe:',
        '        patterns: ["*"]',
        '        update-types: ["minor", "patch"]',
        '      majors:',
        '        patterns: ["*"]',
        '        update-types: ["major"]',
      ].join('\n'),
    )
    expect(evaluateDependabotStackingShape(new AppRepo(root))).toBeNull()
  })

  it('flags an open-pull-requests-limit above 2 on the npm update', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeFile(
      root,
      '.github/dependabot.yml',
      [
        'version: 2',
        'updates:',
        '  - package-ecosystem: "npm"',
        '    directory: "/"',
        '    open-pull-requests-limit: 10',
        '    groups:',
        '      safe:',
        '        patterns: ["*"]',
        '        update-types: ["minor", "patch"]',
        '      majors:',
        '        patterns: ["*"]',
        '        update-types: ["major"]',
      ].join('\n'),
    )
    expect(evaluateDependabotStackingShape(new AppRepo(root))).toContain(
      'open-pull-requests-limit is 10',
    )
  })

  it('flags a single all-in group with no update-types split', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeFile(
      root,
      '.github/dependabot.yml',
      [
        'version: 2',
        'updates:',
        '  - package-ecosystem: "npm"',
        '    directory: "/"',
        '    open-pull-requests-limit: 1',
        '    groups:',
        '      dependencies:',
        '        patterns: ["*"]',
      ].join('\n'),
    )
    expect(evaluateDependabotStackingShape(new AppRepo(root))).toContain(
      'no pair of groups split by update-types',
    )
  })

  it('is null with no .github/dependabot.yml at all (nothing to flag)', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    expect(evaluateDependabotStackingShape(new AppRepo(root))).toBeNull()
  })
})
