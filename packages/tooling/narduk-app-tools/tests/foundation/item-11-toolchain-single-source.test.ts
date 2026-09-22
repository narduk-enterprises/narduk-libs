import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyToolchainFixes,
  formatToolchainSummary,
  planToolchainFixes,
  runToolchainCheck,
  TOOLCHAIN_TOOL_NAME,
} from '../../src/foundation/evaluate-toolchain.js'
import {
  evaluateItem11,
  scanToolchain,
  NODE_SOURCE_FILE,
} from '../../src/foundation/items/item-11-toolchain-single-source.js'
import { AppRepo } from '../../src/foundation/source.js'
import type { FoundationStatus, FoundationSubCheck } from '../../src/foundation/types.js'
import { makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const NODE = '24.21.0'
const PNPM = '10.33.4'

/** A conformant app: both sources declared, mirrors in step, CI reading the
 * sources. Tests move ONE fact away from this per case. */
function baseline(): string {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeFile(root, NODE_SOURCE_FILE, `${NODE}\n`)
  writeJson(root, 'package.json', {
    name: 'fixture-app',
    packageManager: `pnpm@${PNPM}`,
    engines: { node: NODE },
    volta: { node: NODE },
  })
  writeFile(
    root,
    '.github/workflows/ci.yml',
    [
      'name: CI',
      'jobs:',
      '  ci:',
      '    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@6f56678ad7562234e465284e48f27008e0f32db7',
      '    with:',
      `      node-version-file: '${NODE_SOURCE_FILE}'`,
      '      package-manager: pnpm',
    ].join('\n'),
  )
  writeFile(
    root,
    '.github/workflows/copilot-setup-steps.yml',
    [
      'name: Copilot Setup Steps',
      'jobs:',
      '  copilot-setup-steps:',
      '    steps:',
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413',
      '        with:',
      '          dest: ${{ runner.temp }}/setup-pnpm',
      '      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
      '        with:',
      `          node-version-file: ${NODE_SOURCE_FILE}`,
    ].join('\n'),
  )
  return root
}

function checks(root: string): FoundationSubCheck[] {
  const repo = new AppRepo(root)
  return evaluateItem11(repo, scanToolchain(repo))
}

function statusOf(root: string, id: string): FoundationStatus {
  const found = checks(root).find((sub) => sub.id === id)
  if (!found) throw new Error(`no sub-check ${id}`)
  return found.status
}

function detailOf(root: string, id: string): string {
  const found = checks(root).find((sub) => sub.id === id)
  if (!found) throw new Error(`no sub-check ${id}`)
  return found.detail
}

function run(root: string, fix = false) {
  return runToolchainCheck({ root, toolVersion: '0.0.0-test', fix, generated: 'T' })
}

describe('item 11 -- the conformant baseline', () => {
  it('passes with both sources declared and every site reading or matching them', () => {
    const artefact = run(baseline())
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
    expect(artefact.item.status).toBe('pass')
    expect(artefact.sources.node.value).toBe(NODE)
    expect(artefact.sources.pnpm.value).toBe(PNPM)
  })

  it('emits a one-item artefact, never the ratified 7-item shape', () => {
    const artefact = run(baseline())
    expect(artefact.tool).toBe(TOOLCHAIN_TOOL_NAME)
    expect(artefact.contract.items).toBe(1)
    expect(artefact.item.id).toBe(11)
    expect((artefact as unknown as { items?: unknown }).items).toBeUndefined()
  })

  it('lists every declaration site with its value, role and line', () => {
    const artefact = run(baseline())
    const source = artefact.sites.find((site) => site.file === NODE_SOURCE_FILE)!
    expect(source.role).toBe('source')
    expect(source.value).toBe(NODE)
    const engines = artefact.sites.find((site) => site.locator === 'engines.node')!
    expect(engines.role).toBe('mirror')
    expect(engines.line).toBe(5)
    const caller = artefact.sites.find((site) => site.file.endsWith('ci.yml'))!
    expect(caller.role).toBe('derives')
    expect(caller.value).toBe(NODE_SOURCE_FILE)
  })
})

describe('item 11.0 -- a missing or inexact source', () => {
  it('fails when .node-version is absent', () => {
    const root = baseline()
    rmSync(join(root, NODE_SOURCE_FILE))
    expect(statusOf(root, '11.0')).toBe('fail')
    expect(detailOf(root, '11.0')).toContain('declared Node source is missing')
  })

  it('fails when .node-version declares a range rather than an exact version', () => {
    const root = baseline()
    writeFile(root, NODE_SOURCE_FILE, '24\n')
    expect(statusOf(root, '11.0')).toBe('fail')
    expect(detailOf(root, '11.0')).toContain('not an exact x.y.z version')
  })

  it('fails when the root manifest has no packageManager', () => {
    const root = baseline()
    writeJson(root, 'package.json', { name: 'fixture-app', engines: { node: NODE } })
    expect(statusOf(root, '11.0')).toBe('fail')
    expect(detailOf(root, '11.0')).toContain('declared pnpm source is missing')
  })

  it('accepts a corepack integrity suffix on packageManager', () => {
    const root = baseline()
    writeJson(root, 'package.json', {
      name: 'fixture-app',
      packageManager: `pnpm@${PNPM}+sha512.abc123`,
      engines: { node: NODE },
      volta: { node: NODE },
    })
    expect(statusOf(root, '11.0')).toBe('pass')
  })

  it('is unknown, not a failure, when nothing here is an app checkout', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    const artefact = run(root)
    expect(artefact.result).toBe('UNKNOWN')
    expect(artefact.exitCode).toBe(2)
    expect(artefact.item.checks).toHaveLength(1)
  })
})

describe('item 11.1 / 11.2 -- mirrors that disagree with the source', () => {
  it.each([
    [
      'engines.node',
      (root: string) =>
        writeJson(root, 'package.json', {
          name: 'fixture-app',
          packageManager: `pnpm@${PNPM}`,
          engines: { node: '22.22.3' },
          volta: { node: NODE },
        }),
    ],
    [
      'volta.node',
      (root: string) =>
        writeJson(root, 'package.json', {
          name: 'fixture-app',
          packageManager: `pnpm@${PNPM}`,
          engines: { node: NODE },
          volta: { node: '22.22.3' },
        }),
    ],
    ['.nvmrc', (root: string) => writeFile(root, '.nvmrc', '22.22.3\n')],
    ['.tool-versions', (root: string) => writeFile(root, '.tool-versions', 'nodejs 22.22.3\n')],
    [
      'apps/web volta.node',
      (root: string) =>
        writeJson(root, 'apps/web/package.json', { name: 'web', volta: { node: '22.22.3' } }),
    ],
  ])('fails 11.1 when %s drifts off the Node source', (_label, drift) => {
    const root = baseline()
    expect(statusOf(root, '11.1')).toBe('pass')
    drift(root)
    expect(statusOf(root, '11.1')).toBe('fail')
    expect(detailOf(root, '11.1')).toContain('22.22.3')
    expect(detailOf(root, '11.1')).toContain(`expected ${NODE}`)
  })

  it('fails 11.2 when engines.pnpm drifts off packageManager', () => {
    const root = baseline()
    expect(statusOf(root, '11.2')).toBe('pass')
    writeJson(root, 'package.json', {
      name: 'fixture-app',
      packageManager: `pnpm@${PNPM}`,
      engines: { node: NODE, pnpm: '10.0.0' },
      volta: { node: NODE },
    })
    expect(statusOf(root, '11.2')).toBe('fail')
    expect(detailOf(root, '11.2')).toContain('10.0.0')
  })

  it('accepts an app that keeps an agreeing .nvmrc', () => {
    const root = baseline()
    writeFile(root, '.nvmrc', `${NODE}\n`)
    expect(statusOf(root, '11.1')).toBe('pass')
    expect(run(root).result).toBe('PASS')
  })
})

describe('item 11.3 / 11.4 -- CI restating instead of reading', () => {
  it('fails when the shared-workflow caller pins a Node literal', () => {
    const root = baseline()
    writeFile(
      root,
      '.github/workflows/ci.yml',
      [
        'name: CI',
        'jobs:',
        '  ci:',
        '    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@6f56678ad7562234e465284e48f27008e0f32db7',
        '    with:',
        `      node-version: '${NODE}'`,
      ].join('\n'),
    )
    expect(statusOf(root, '11.3')).toBe('fail')
    // Even a literal that AGREES with the source is a finding: it is a second
    // declaration, which is the thing being removed.
    expect(statusOf(root, '11.1')).toBe('pass')
    expect(detailOf(root, '11.3')).toContain(`node-version-file: ${NODE_SOURCE_FILE}`)
  })

  it('fails when a node-version-file points somewhere other than the source', () => {
    const root = baseline()
    writeFile(
      root,
      '.github/workflows/ci.yml',
      [
        'name: CI',
        'jobs:',
        '  ci:',
        '    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@6f56678ad7562234e465284e48f27008e0f32db7',
        '    with:',
        "      node-version-file: '.nvmrc'",
      ].join('\n'),
    )
    expect(statusOf(root, '11.3')).toBe('fail')
    expect(detailOf(root, '11.3')).toContain('.nvmrc')
  })

  it('fails when pnpm/action-setup pins a version instead of reading packageManager', () => {
    const root = baseline()
    writeFile(
      root,
      '.github/workflows/copilot-setup-steps.yml',
      [
        'name: Copilot Setup Steps',
        'jobs:',
        '  copilot-setup-steps:',
        '    steps:',
        '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413',
        '        with:',
        `          version: ${PNPM}`,
        '      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        '        with:',
        `          node-version-file: ${NODE_SOURCE_FILE}`,
      ].join('\n'),
    )
    expect(statusOf(root, '11.4')).toBe('fail')
    expect(detailOf(root, '11.4')).toContain('drop the `version:` input')
  })

  it("does not read the NEXT step's version input as this action's", () => {
    const root = baseline()
    writeFile(
      root,
      '.github/workflows/copilot-setup-steps.yml',
      [
        'name: Copilot Setup Steps',
        'jobs:',
        '  copilot-setup-steps:',
        '    steps:',
        '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413',
        '      - uses: some/other-action@ea17c68df8912ef543352723c149a84f56e3d413',
        '        with:',
        '          version: 9.9.9',
      ].join('\n'),
    )
    expect(statusOf(root, '11.4')).toBe('pass')
  })

  it('is not-applicable when no workflow sets up Node or pnpm', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeFile(root, NODE_SOURCE_FILE, `${NODE}\n`)
    writeJson(root, 'package.json', {
      name: 'fixture-app',
      packageManager: `pnpm@${PNPM}`,
      engines: { node: NODE },
      volta: { node: NODE },
    })
    expect(statusOf(root, '11.3')).toBe('not-applicable')
    expect(statusOf(root, '11.4')).toBe('not-applicable')
    expect(run(root).result).toBe('PASS')
  })
})

const PIN = '67968e304ba64e7733dc36d23d80eefda8d72e33'
const callerJob = (job: string, callable: string, inputs: string[] = []) => [
  `  ${job}:`,
  `    uses: narduk-enterprises/workflows/.github/workflows/${callable}.yml@${PIN}`,
  ...(inputs.length > 0 ? ['    with:', ...inputs.map((input) => `      ${input}`)] : []),
]

describe('item 11.3 -- what each shared callable can accept (#544)', () => {
  it('does not treat a callable with no Node input as a Node site', () => {
    const root = baseline()
    writeFile(
      root,
      '.github/workflows/cursor-review.yml',
      ['name: Cursor review', 'jobs:', ...callerJob('review', 'cursor-review', ['model: x'])].join(
        '\n',
      ),
    )
    expect(statusOf(root, '11.3')).toBe('pass')
    expect(detailOf(root, '11.3')).not.toContain('cursor-review')
  })

  it('is n/a, not a failure, for a repo whose only callable has no Node input', () => {
    const root = baseline()
    rmSync(join(root, '.github/workflows/ci.yml'))
    rmSync(join(root, '.github/workflows/copilot-setup-steps.yml'))
    writeFile(
      root,
      '.github/workflows/cursor-review.yml',
      ['name: Cursor review', 'jobs:', ...callerJob('review', 'cursor-review')].join('\n'),
    )
    expect(statusOf(root, '11.3')).toBe('not-applicable')
  })

  it('still fails a nuxt-cloudflare caller that passes nothing, since it can pass node-version-file', () => {
    const root = baseline()
    writeFile(
      root,
      '.github/workflows/ci.yml',
      ['name: CI', 'jobs:', ...callerJob('ci', 'nuxt-cloudflare')].join('\n'),
    )
    expect(statusOf(root, '11.3')).toBe('fail')
    expect(detailOf(root, '11.3')).toContain(`node-version-file: ${NODE_SOURCE_FILE}`)
  })

  it('never tells a node-version-only caller to use node-version-file; 11.1 holds its literal', () => {
    const root = baseline()
    const write = (value: string) =>
      writeFile(
        root,
        '.github/workflows/library.yml',
        [
          'name: Library',
          'jobs:',
          ...callerJob('library', 'node-library', [`node-version: '${value}'`]),
        ].join('\n'),
      )
    write(NODE)
    expect(statusOf(root, '11.3')).toBe('pass')
    expect(detailOf(root, '11.3')).toContain('workflows#135')
    expect(statusOf(root, '11.1')).toBe('pass')

    write('22.22.3')
    expect(statusOf(root, '11.3')).toBe('pass')
    expect(statusOf(root, '11.1')).toBe('fail')
    expect(detailOf(root, '11.1')).toContain('22.22.3')
  })

  it("does not let one job's node-version-file satisfy another job in the same file", () => {
    const root = baseline()
    writeFile(
      root,
      '.github/workflows/ci.yml',
      [
        'name: CI',
        'jobs:',
        ...callerJob('ci', 'nuxt-cloudflare', [`node-version-file: '${NODE_SOURCE_FILE}'`]),
        '  extra:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        '        with:',
        `          node-version: '${NODE}'`,
      ].join('\n'),
    )
    expect(statusOf(root, '11.3')).toBe('fail')
    expect(detailOf(root, '11.3')).toContain('.github/workflows/ci.yml:12 (actions/setup-node step')
  })
})

describe('item 11.5 -- the Workers Builds build environment', () => {
  const doc = (node: string, pnpm: string) =>
    [
      '# App deployments',
      '',
      '| Setting                       | Value                                                 |',
      '| ----------------------------- | ----------------------------------------------------- |',
      '| Build cache                   | enabled                                               |',
      '| `NODE_VERSION`                | `' +
        node +
        '`                                             |',
      '| `PNPM_VERSION`                | `' +
        pnpm +
        '`                                             |',
      '',
    ].join('\n')

  it('passes when both rows match the sources', () => {
    const root = baseline()
    writeFile(root, 'docs/workers-builds.md', doc(NODE, PNPM))
    expect(statusOf(root, '11.5')).toBe('pass')
  })

  it('fails when a row records a version the repository no longer declares', () => {
    const root = baseline()
    writeFile(root, 'docs/workers-builds.md', doc('22.22.3', PNPM))
    expect(statusOf(root, '11.5')).toBe('fail')
    expect(detailOf(root, '11.5')).toContain('Cloudflare dashboard')
  })

  it('is not-applicable when the app has no such doc', () => {
    expect(statusOf(baseline(), '11.5')).toBe('not-applicable')
  })
})

describe('--fix', () => {
  it('rewrites every drifted mirror to the source and leaves the file otherwise byte-identical', () => {
    const root = baseline()
    const manifestBefore = [
      '{',
      '  "name": "fixture-app",',
      '  "packageManager": "pnpm@10.33.4",',
      '  "engines": {',
      '    "node": "22.22.3",',
      '    "pnpm": "10.0.0"',
      '  },',
      '  "volta": {',
      '    "node": "22.22.3"',
      '  },',
      '  "scripts": {',
      '    "keep": "node --version"',
      '  }',
      '}',
      '',
    ].join('\n')
    writeFile(root, 'package.json', manifestBefore)
    writeFile(root, '.nvmrc', '22.22.3\n')

    const artefact = run(root, true)
    expect(artefact.result).toBe('PASS')
    expect(
      artefact.fixes.map((fix) => `${fix.file}:${fix.line} ${fix.before}->${fix.after}`),
    ).toEqual([
      '.nvmrc:1 22.22.3->24.21.0',
      'package.json:5 22.22.3->24.21.0',
      'package.json:6 10.0.0->10.33.4',
      'package.json:9 22.22.3->24.21.0',
    ])

    const after = readFileSync(join(root, 'package.json'), 'utf8')
    expect(after).toBe(manifestBefore.replaceAll('22.22.3', NODE).replace('10.0.0', PNPM))
    expect(JSON.parse(after).scripts.keep).toBe('node --version')
  })

  it('never touches a workflow: swapping node-version for node-version-file is a shape change', () => {
    const root = baseline()
    const before = [
      'name: CI',
      'jobs:',
      '  ci:',
      '    uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@6f56678ad7562234e465284e48f27008e0f32db7',
      '    with:',
      `      node-version: '${NODE}'`,
    ].join('\n')
    writeFile(root, '.github/workflows/ci.yml', before)
    const artefact = run(root, true)
    expect(artefact.fixes).toEqual([])
    expect(artefact.result).toBe('FAIL')
    expect(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')).toBe(before)
  })

  it('does nothing when there is no source to fix toward', () => {
    const root = baseline()
    rmSync(join(root, NODE_SOURCE_FILE))
    writeFile(root, '.nvmrc', '22.22.3\n')
    const repo = new AppRepo(root)
    expect(planToolchainFixes(scanToolchain(repo))).toEqual([])
    expect(readFileSync(join(root, '.nvmrc'), 'utf8')).toBe('22.22.3\n')
  })

  it('keeps a Markdown table aligned when the padding can absorb the width change', () => {
    const root = baseline()
    const row = '| `NODE_VERSION`   | `22.22.30`      |'
    writeFile(root, 'docs/workers-builds.md', ['# doc', '', row, ''].join('\n'))
    run(root, true)
    const after = readFileSync(join(root, 'docs/workers-builds.md'), 'utf8').split('\n')[2]
    expect(after).toContain('`24.21.0`')
    expect(after.length).toBe(row.length)
  })

  it('reports the post-fix truth rather than a prediction of it', () => {
    const root = baseline()
    writeFile(root, '.nvmrc', '22.22.3\n')
    expect(run(root).result).toBe('FAIL')
    const fixed = run(root, true)
    expect(fixed.result).toBe('PASS')
    expect(fixed.sites.find((site) => site.file === '.nvmrc')?.value).toBe(NODE)
  })
})

describe('the printed table', () => {
  it('names every site, its value and its verdict', () => {
    const summary = formatToolchainSummary(run(baseline()))
    expect(summary).toContain('WHERE')
    expect(summary).toContain(`${NODE_SOURCE_FILE}:1`)
    expect(summary).toContain('package.json:3')
    expect(summary).toContain('RESULT: PASS')
  })

  it('prints what --fix rewrote', () => {
    const root = baseline()
    writeFile(root, '.nvmrc', '22.22.3\n')
    const summary = formatToolchainSummary(run(root, true))
    expect(summary).toContain('fixed 1 mirror(s):')
    expect(summary).toContain('.nvmrc:1 nvm mirror  22.22.3 -> 24.21.0')
  })
})

describe('applyToolchainFixes refuses an ambiguous rewrite', () => {
  it('leaves a line alone when the located literal is a prefix of a longer version', () => {
    const root = baseline()
    writeFile(root, '.nvmrc', '24.21.0-rc.1\n')
    const applied = applyToolchainFixes(root, [
      { file: '.nvmrc', line: 1, locator: 'nvm mirror', before: '24.21.0', after: '25.0.0' },
    ])
    expect(applied).toEqual([])
    expect(readFileSync(join(root, '.nvmrc'), 'utf8')).toBe('24.21.0-rc.1\n')
  })
})
