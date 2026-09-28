/**
 * The `upgrade` half of company-hq NAC-GATE-PARITY (§3.11): an existing app's
 * CI gains every repository-stage command it lacks, and nothing the app owns
 * moves. Each fixture is a real scaffold on disk, taken back to an older
 * shape by hand -- the shape apps generated before this change actually have.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  CANDIDATE_SECURITY_HEADERS_STEP_NAME,
  REPOSITORY_GATE_STEP_NAME,
} from '../src/ci-workflow.js'
import { createNardukApp, formatUpgradeReport, upgradeNardukApp } from '../src/index.js'
import type { UpgradeReport } from '../src/index.js'
import type { AppVisibility } from '../src/types.js'

const CI = '.github/workflows/ci.yml'

const tempDirectories: string[] = []
afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function scaffold(visibility: AppVisibility = 'private'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-narduk-upgrade-gate-'))
  tempDirectories.push(directory)
  const targetDir = join(directory, 'app')
  await createNardukApp({
    appName: 'gate-upgrade-fixture',
    capabilities: 'seo,analytics',
    noGit: true,
    targetDir,
    visibility,
  })
  return targetDir
}

async function read(targetDir: string, path: string): Promise<string> {
  return readFile(join(targetDir, path), 'utf8')
}

async function edit(targetDir: string, path: string, mutate: (text: string) => string) {
  const before = await read(targetDir, path)
  const after = mutate(before)
  expect(after, 'fixture edit changed nothing in ' + path).not.toBe(before)
  await writeFile(join(targetDir, path), after, 'utf8')
}

function change(report: UpgradeReport, path: string) {
  const found = report.changes.find((entry) => entry.path === path)
  expect(found, path).toBeDefined()
  return found!
}

const GATE_SCRIPTS = [
  'foundation:shared-ui-pinned',
  'foundation:check:coverage',
  'foundation:check:toolchain',
  'foundation:check:deployment',
]

/** A private caller as create-narduk-app 0.14 emitted it: no standard gate. */
function toLegacyCaller(ci: string): string {
  return ci
    .replace(
      /^ {6}extra-scripts: '.*'$/mu,
      "      extra-scripts: 'format:check lint knip manifests:validate foundation:shared-ui-pinned'",
    )
    .replace(/^ {6}quality-level: standard\n/mu, '')
    .replace(/^ {6}performance-budget-args: .*\n/mu, '')
}

async function withoutGateScripts(targetDir: string, keep: string[] = []) {
  await edit(targetDir, 'package.json', (text) =>
    text
      .split('\n')
      .filter(
        (line) =>
          !GATE_SCRIPTS.filter((name) => !keep.includes(name)).some((name) =>
            new RegExp('^\\s*"' + name + '":').test(line),
          ),
      )
      .join('\n'),
  )
}

describe('upgrade completes a private caller', () => {
  it('adds the gate to a pre-standard caller and keeps every app-owned line', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, (text) =>
      toLegacyCaller(text)
        // App-owned inputs and a comment that must survive untouched.
        .replace('      e2e-shards: 3', '      e2e-shards: 5 # app-owned: five shards'),
    )
    await withoutGateScripts(targetDir, ['foundation:shared-ui-pinned'])
    const before = await read(targetDir, CI)

    const report = await upgradeNardukApp({ targetDir, write: true })
    const ci = change(report, CI)
    expect(ci.status).toBe('drift')
    expect(ci.applied).toBe(true)
    expect(ci.detail).toContain('Adds the repository gate')

    const after = await read(targetDir, CI)
    const inputs = (parse(after) as { jobs: { ci: { with: Record<string, unknown> } } }).jobs.ci
      .with
    expect(String(inputs['extra-scripts']).split(' ')).toEqual([
      'format:check',
      'lint',
      'knip',
      'manifests:validate',
      ...GATE_SCRIPTS,
    ])
    expect(inputs['quality-level']).toBe('standard')
    expect(inputs['performance-budget-args']).toBe('--app-dir apps/web')
    expect(inputs['e2e-shards']).toBe(5)
    // Every line the edit did not own is byte-identical, in order.
    const kept = before.split('\n').filter((line) => !line.includes('extra-scripts:'))
    const remaining = after
      .split('\n')
      .filter(
        (line) =>
          !line.includes('extra-scripts:') &&
          !/^ {6}(?:quality-level|performance-budget-args):/u.test(line),
      )
    expect(remaining).toEqual(kept)

    // The scripts CI now names exist, created with the generator's bodies.
    const scripts = (
      JSON.parse(await read(targetDir, 'package.json')) as {
        scripts: Record<string, string>
      }
    ).scripts
    for (const name of GATE_SCRIPTS) expect(scripts[name], name).toBeTruthy()
    expect(scripts['foundation:check:coverage']).toContain(
      'narduk-app foundation:check:coverage --checkout .',
    )
    // The quality bar moves with the caller in the same run.
    expect(change(report, 'AGENTS.md').status).toBe('clean')
    expect(report.profile.ciQualityLevel).toBe('standard')
    expect(await read(targetDir, 'AGENTS.md')).toContain('this app runs `quality-level: standard`')

    const again = await upgradeNardukApp({ targetDir })
    expect(again.driftCount).toBe(0)
    expect(change(again, CI).status).toBe('clean')
  })

  it("keeps an app's own script bodies and quoting, appending only missing names", async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, (text) =>
      text.replace(
        /^ {6}extra-scripts: '.*'$/mu,
        '      extra-scripts: format:check lint knip:dead-code foundation:check:coverage # app list',
      ),
    )
    await edit(targetDir, 'package.json', (text) =>
      text.replace(
        /"foundation:check:coverage": ".*"/u,
        '"foundation:check:coverage": "narduk-app foundation:check:coverage --checkout . --json app-owned.json"',
      ),
    )

    await upgradeNardukApp({ targetDir, write: true })
    const after = await read(targetDir, CI)
    expect(after).toContain(
      '      extra-scripts: format:check lint knip:dead-code foundation:check:coverage foundation:shared-ui-pinned foundation:check:toolchain foundation:check:deployment # app list',
    )
    const scripts = (
      JSON.parse(await read(targetDir, 'package.json')) as {
        scripts: Record<string, string>
      }
    ).scripts
    expect(scripts['foundation:check:coverage']).toBe(
      'narduk-app foundation:check:coverage --checkout . --json app-owned.json',
    )
  })

  it('turns an explicit legacy level into standard', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, (text) =>
      text.replace('      quality-level: standard', '      quality-level: legacy'),
    )
    await upgradeNardukApp({ targetDir, write: true })
    expect(await read(targetDir, CI)).toContain('      quality-level: standard\n')
    expect(await read(targetDir, CI)).not.toContain('quality-level: legacy')
  })

  it('never writes an opt-out: preview-checks none leaves the unit unresolved', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, (text) =>
      toLegacyCaller(text).replace(
        '      run-tests: true',
        '      preview-checks: none\n      run-tests: true',
      ),
    )
    const report = await upgradeNardukApp({ targetDir, write: true })
    const ci = change(report, CI)
    expect(ci.status).toBe('unresolved')
    expect(ci.applied).toBe(true)
    expect(ci.detail).toContain('preview-checks: none')
    expect(ci.detail).toContain('upgrade writes neither')
    expect(formatUpgradeReport(report)).toContain('partial')
    const after = await read(targetDir, CI)
    // The parts that work as configured land; the level does not.
    expect(after).toContain('foundation:check:toolchain')
    expect(after).not.toContain('quality-level')
    expect(after).not.toContain('quality-opt-out')
    expect(report.profile.ciQualityLevel).toBe('legacy')

    const again = await upgradeNardukApp({ targetDir })
    expect(change(again, CI).status).toBe('unresolved')
    expect(again.driftCount).toBeGreaterThan(0)
  })

  it("accepts the app's own recorded security-headers opt-out", async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, (text) =>
      toLegacyCaller(text).replace(
        '      run-tests: true',
        "      preview-checks: none\n      quality-opt-out: 'security-headers=no preview bindings yet (app#1)'\n      run-tests: true",
      ),
    )
    const report = await upgradeNardukApp({ targetDir, write: true })
    expect(change(report, CI).status).toBe('drift')
    expect(await read(targetDir, CI)).toContain('      quality-level: standard\n')
  })

  it('will not name a script package.json will not have (--only ci.yml)', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, toLegacyCaller)
    await withoutGateScripts(targetDir, ['foundation:shared-ui-pinned'])

    const report = await upgradeNardukApp({ only: [CI], targetDir, write: true })
    const ci = change(report, CI)
    expect(ci.status).toBe('unresolved')
    expect(ci.detail).toContain('foundation:check:coverage')
    const after = await read(targetDir, CI)
    expect(after).not.toContain('foundation:check:coverage')
    expect(after).toContain('      quality-level: standard\n')
  })

  it('reports a block-scalar extra-scripts instead of rewriting it', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, (text) =>
      text.replace(
        /^ {6}extra-scripts: '.*'$/mu,
        '      extra-scripts: >-\n        format:check lint knip',
      ),
    )
    const report = await upgradeNardukApp({ targetDir, write: true })
    const ci = change(report, CI)
    expect(ci.status).toBe('unresolved')
    expect(ci.detail).toContain('`extra-scripts` is not a single-line value')
    expect(await read(targetDir, CI)).toContain(
      '      extra-scripts: >-\n        format:check lint knip\n',
    )
  })

  it("warns, without failing, when the app's Nuxt config does not enforce CSP", async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, toLegacyCaller)
    await edit(targetDir, 'apps/web/nuxt.config.ts', (text) =>
      text.replace('headers: { enabled: true, enforce: true }', 'headers: { enabled: true }'),
    )
    const report = await upgradeNardukApp({ targetDir, write: true })
    const ci = change(report, CI)
    expect(ci.status).toBe('drift')
    expect(ci.detail).toContain('no `enforce: true` in the Nuxt config')
  })

  it('does not warn when the same run adds the enforced preset', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, toLegacyCaller)
    // An analytics app, so pin a narduk-core whose baseline allows the proxy.
    await edit(targetDir, 'apps/web/package.json', (text) =>
      text.replace(
        /"@narduk-enterprises\/narduk-core": "[^"]+"/u,
        '"@narduk-enterprises/narduk-core": "2.20.0"',
      ),
    )
    await edit(targetDir, 'apps/web/nuxt.config.ts', (text) =>
      text.replace(
        '    security: {\n      headers: { enabled: true, enforce: true },\n    },\n',
        '',
      ),
    )
    const report = await upgradeNardukApp({ targetDir, write: true })
    expect(change(report, 'apps/web/nuxt.config.ts').status).toBe('drift')
    const ci = change(report, CI)
    expect(ci.status).toBe('drift')
    expect(ci.detail).not.toContain('no `enforce: true` in the Nuxt config')
  })
})

describe("upgrade grants the shared workflow's caller permissions", () => {
  /** The caller's permissions as every private app was generated before 2026-09-28. */
  function toNarrowCaller(ci: string): string {
    return ci.replace(/^ {6}actions: read\n {6}pull-requests: write\n/mu, '')
  }

  function callerPermissions(ci: string): Record<string, string> {
    return (parse(ci) as { jobs: { ci: { permissions: Record<string, string> } } }).jobs.ci
      .permissions
  }

  it('adds what the pinned workflow needs, keeps app-owned grants, and is then clean', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, (text) =>
      toNarrowCaller(text).replace(
        '      packages: read\n',
        '      packages: read\n      id-token: write # app-owned\n',
      ),
    )

    const report = await upgradeNardukApp({ targetDir, write: true })
    const ci = change(report, CI)
    expect(ci.status).toBe('drift')
    expect(ci.detail).toContain('Grants the caller actions: read, pull-requests: write.')

    const after = await read(targetDir, CI)
    expect(callerPermissions(after)).toEqual({
      actions: 'read',
      contents: 'read',
      'id-token': 'write',
      packages: 'read',
      'pull-requests': 'write',
    })
    expect(after).toContain('      id-token: write # app-owned\n')

    const again = await upgradeNardukApp({ targetDir })
    expect(change(again, CI).status).toBe('clean')
  })

  it('reports, rather than widens, a grant the app wrote narrower', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, (text) =>
      text.replace('      pull-requests: write\n', '      pull-requests: read\n'),
    )
    const before = await read(targetDir, CI)

    const report = await upgradeNardukApp({ targetDir, write: true })
    const ci = change(report, CI)
    expect(ci.status).toBe('unresolved')
    expect(ci.detail).toContain('grants `pull-requests: read`')
    expect(await read(targetDir, CI)).toBe(before)
  })

  it('reports a one-line permissions value instead of rewriting it', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, CI, (text) =>
      text.replace(
        /^ {4}permissions:\n(?: {6}[a-z-]+: [a-z]+\n)+(?= {4}with:)/mu,
        '    permissions: read-all\n',
      ),
    )

    const report = await upgradeNardukApp({ targetDir })
    const ci = change(report, CI)
    expect(ci.status).toBe('unresolved')
    expect(ci.detail).toContain('sets `permissions:` on one line')
  })
})

describe('upgrade completes a public workflow', () => {
  async function stripPublicGate(targetDir: string) {
    await edit(targetDir, CI, (text) => {
      const lines = text.split('\n')
      const start = lines.findIndex((line) => line.includes('# Web foundation items 1-7'))
      const end = lines.findIndex((line, index) => index > start && line.trim() === '')
      return [...lines.slice(0, start), ...lines.slice(end)].join('\n')
    })
  }

  it('inserts both gate steps after quality:static, and is then clean', async () => {
    const targetDir = await scaffold('public')
    const generated = await read(targetDir, CI)
    await stripPublicGate(targetDir)
    await withoutGateScripts(targetDir, ['foundation:shared-ui-pinned'])

    const report = await upgradeNardukApp({ targetDir, write: true })
    expect(change(report, CI).status).toBe('drift')
    expect(await read(targetDir, CI)).toBe(generated)
    const again = await upgradeNardukApp({ targetDir })
    expect(change(again, CI).status).toBe('clean')
    expect(again.driftCount).toBe(0)
  })

  it('adds only the missing step', async () => {
    const targetDir = await scaffold('public')
    await edit(targetDir, CI, (text) => {
      const lines = text.split('\n')
      const start = lines.findIndex((line) => line.includes(CANDIDATE_SECURITY_HEADERS_STEP_NAME))
      const end = lines.findIndex((line, index) => index > start && line.trim() === '')
      return [...lines.slice(0, start), ...lines.slice(end)].join('\n')
    })
    await upgradeNardukApp({ targetDir, write: true })
    const after = await read(targetDir, CI)
    expect(after.split(REPOSITORY_GATE_STEP_NAME)).toHaveLength(2)
    expect(after.split(CANDIDATE_SECURITY_HEADERS_STEP_NAME)).toHaveLength(2)
  })

  it('says what it could not find instead of guessing where the steps go', async () => {
    const targetDir = await scaffold('public')
    await stripPublicGate(targetDir)
    await edit(targetDir, CI, (text) =>
      text.replace('      - run: pnpm run quality:static', '      - run: pnpm run check'),
    )
    const report = await upgradeNardukApp({ targetDir, write: true })
    const ci = change(report, CI)
    expect(ci.status).toBe('unresolved')
    expect(ci.applied).toBe(false)
    expect(ci.detail).toContain(REPOSITORY_GATE_STEP_NAME)
  })
})
