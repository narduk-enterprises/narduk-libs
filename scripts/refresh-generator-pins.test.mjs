import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  compareVersions,
  exactPeerPins,
  refreshPackagePins,
  rewritePackagePins,
  selectVersion,
  workflowRefresh,
} from './refresh-generator-pins.mjs'

const now = Date.parse('2026-10-08T12:00:00Z')
const options = { now, cooldownDays: 14 }
function metadata(releases) {
  return {
    versions: Object.fromEntries(
      Object.entries(releases).map(([version, value]) => [version, value.manifest ?? {}]),
    ),
    time: Object.fromEntries(
      Object.entries(releases).map(([version, value]) => [version, value.time]),
    ),
  }
}
const old = '2026-09-01T00:00:00Z'

test('selects the greatest mature same-major release, including the exact age boundary', () => {
  const versions = metadata({
    '6.14.1': { time: old },
    '6.39.0': { time: '2026-09-24T12:00:00Z' },
    '6.39.1': { time: '2026-09-24T12:00:00.001Z' },
    '6.40.0': { time: '2026-10-06T00:00:00Z' },
    '7.0.0': { time: old },
    '6.99.0-beta.1': { time: old },
    '6.99.1': { time: old, manifest: { deprecated: 'withdrawn' } },
    '6.99.2': {},
    '6.99.3': { time: 'not a timestamp' },
  })
  assert.equal(selectVersion('6.14.1', versions, options), '6.39.0')
  assert.ok(compareVersions('6.10.0', '6.9.0') > 0)
})

test('does not downgrade a deliberately fresh or deprecated current pin', () => {
  assert.equal(selectVersion('6.40.0', metadata({ '6.39.0': { time: old } }), options), '6.40.0')
})

test('holds exact shared-package peer contracts and rejects a generator pin that violates one', async () => {
  const workspace = {
    byName: new Map([
      [
        '@narduk-enterprises/narduk-core',
        { manifest: { peerDependencies: { '@nuxt/ui': '4.11.1', nuxt: '>=4.0.0' } } },
      ],
    ]),
  }
  const pins = { '@narduk-enterprises/narduk-core': '2.0.0', '@nuxt/ui': '4.11.1', nuxt: '4.5.2' }
  const held = exactPeerPins(workspace, pins)
  assert.deepEqual([...held], [['@nuxt/ui', '4.11.1']])
  const lookedUp = []
  const updates = await refreshPackagePins(
    pins,
    { DEPENDENCY_COOLDOWN_DAYS: 14, DEPENDENCY_UPDATE_LIMITS: {} },
    {
      now,
      held,
      lookup: async (name) => {
        lookedUp.push(name)
        return metadata({ '4.6.0': { time: old } })
      },
    },
  )
  assert.deepEqual(lookedUp, ['nuxt'])
  assert.deepEqual([...updates], [['nuxt', '4.6.0']])
  assert.throws(
    () => exactPeerPins(workspace, { ...pins, '@nuxt/ui': '4.11.2' }),
    /requires @nuxt\/ui@4.11.1/u,
  )
})

test('honors inclusive browser and exclusive TypeScript ceilings', () => {
  const versions = metadata({
    '6.0.4': { time: old },
    '6.1.0': { time: old },
    '6.2.0': { time: old },
  })
  assert.equal(
    selectVersion('6.0.3', versions, { ...options, limit: { version: '6.1.0', inclusive: false } }),
    '6.0.4',
  )
  assert.equal(
    selectVersion('6.0.3', versions, { ...options, limit: { version: '6.1.0', inclusive: true } }),
    '6.1.0',
  )
})

test('rejects unusable registry metadata and invalid clocks instead of calling it current', () => {
  assert.throws(() => selectVersion('1.0.0', {}, options), /metadata/u)
  assert.throws(
    () => selectVersion('1.0.0', metadata({}), { now: NaN, cooldownDays: 14 }),
    /clock/u,
  )
  assert.throws(() => compareVersions('1.0.0-rc.1', '1.0.0'), /stable exact/u)
})

test('excludes internal packages, bounds lookups and fails the refresh on any lookup error', async () => {
  const pins = {
    '@narduk-enterprises/narduk-core': '2.0.0',
    ...Object.fromEntries(Array.from({ length: 9 }, (_, n) => [`package-${n}`, '1.0.0'])),
  }
  const policy = { DEPENDENCY_COOLDOWN_DAYS: 14, DEPENDENCY_UPDATE_LIMITS: {} }
  let active = 0
  let peak = 0
  const lookedUp = []
  const updates = await refreshPackagePins(pins, policy, {
    now,
    lookup: async (name) => {
      lookedUp.push(name)
      active += 1
      peak = Math.max(peak, active)
      await new Promise((done) => setImmediate(done))
      active -= 1
      return metadata({ '1.1.0': { time: old } })
    },
  })
  assert.equal(updates.size, 9)
  assert.equal(
    lookedUp.some((name) => name.startsWith('@narduk-enterprises/')),
    false,
  )
  assert.equal(peak, 4)
  await assert.rejects(
    refreshPackagePins(pins, policy, {
      now,
      lookup: async () => {
        throw new Error('registry unavailable')
      },
    }),
    /registry unavailable/u,
  )
})

test('rewrites only PACKAGE_VERSIONS and fails if a requested pin cannot be located', () => {
  const source =
    "export const PACKAGE_VERSIONS = {\n  knip: '6.14.1',\n  '@nuxt/ui': '4.1.0',\n} as const\nconst elsewhere = { knip: '6.14.1' }\n"
  const updated = rewritePackagePins(
    source,
    new Map([
      ['knip', '6.39.0'],
      ['@nuxt/ui', '4.2.0'],
    ]),
  )
  assert.match(updated, /knip: '6.39.0'/u)
  assert.match(updated, /const elsewhere = \{ knip: '6.14.1' \}/u)
  assert.throws(
    () => rewritePackagePins(source, new Map([['missing', '1.0.0']])),
    /Could not locate/u,
  )
})

test('workflow refresh keeps full ancestry, refuses backward pins and no-ops at the current pin', () => {
  const directory = mkdtempSync(join(tmpdir(), 'generator-workflow-history-'))
  const git = (...args) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  try {
    git('init', '--initial-branch=main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    writeFileSync(join(directory, 'fixture'), 'one')
    git('add', 'fixture')
    git('commit', '-m', 'one')
    const first = git('rev-parse', 'HEAD')
    const source = `export const NUXT_CLOUDFLARE_WORKFLOW_SHA = '${first}'\nexport const NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS = [\n] as const\n`
    assert.equal(workflowRefresh(directory, source), null)
    git('commit', '--allow-empty', '-m', 'two')
    const second = git('rev-parse', 'HEAD')
    const result = workflowRefresh(directory, source)
    assert.equal(result.latest, second)
    assert.match(result.source, new RegExp(`WORKFLOW_SHA = '${second}'`, 'u'))
    assert.match(result.source, new RegExp(`ANCESTORS = \\[\n  '${first}',`, 'u'))
    assert.match(result.history, new RegExp(first, 'u'))
    git('checkout', '--detach', first)
    assert.throws(() => workflowRefresh(directory, result.source))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
