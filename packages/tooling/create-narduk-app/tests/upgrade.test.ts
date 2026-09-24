import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createNardukApp,
  formatUpgradeReport,
  inferUpgradeProfile,
  MANAGED_SCRIPT_KEYS,
  MANAGED_TARGETS,
  REGION_MARKERS,
  runCli,
  unifiedDiff,
  upgradeNardukApp,
} from '../src/index.js'
import type { UpgradeReport } from '../src/index.js'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

/** A real scaffold on disk -- the fixture every ownership claim is measured against. */
async function scaffold(
  options: { capabilities?: string; databaseBackend?: 'd1' | 'none' } = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-narduk-upgrade-'))
  tempDirectories.push(directory)
  const targetDir = join(directory, 'app')
  await createNardukApp({
    appName: 'upgrade-fixture',
    capabilities: options.capabilities ?? 'seo,analytics',
    databaseBackend: options.databaseBackend,
    noGit: true,
    targetDir,
  })
  return targetDir
}

async function read(targetDir: string, path: string): Promise<string> {
  return readFile(join(targetDir, path), 'utf8')
}

async function edit(
  targetDir: string,
  path: string,
  mutate: (contents: string) => string,
): Promise<void> {
  await writeFile(join(targetDir, path), mutate(await read(targetDir, path)), 'utf8')
}

function statusOf(report: UpgradeReport, path: string): string {
  return report.changes.find((change) => change.path === path)?.status ?? 'missing-from-report'
}

describe('upgrade ownership contract', () => {
  it('reports no drift against a freshly generated app', async () => {
    const targetDir = await scaffold()
    const report = await upgradeNardukApp({ targetDir })

    expect(report.driftCount).toBe(0)
    expect(report.changes).toHaveLength(MANAGED_TARGETS.length)
    expect(report.changes.every((change) => change.status === 'clean')).toBe(true)
    expect(report.changes.every((change) => change.diff === '')).toBe(true)
  })

  // narduk-libs#384. The generator scaffolds `nardukSeo.aiCrawlers` and,
  // with a contact, `nardukSeo.securityTxt` -- but the AI-crawler policy and
  // the security contact are exactly the kind of thing an app changes after
  // generation, and re-imposing either would be the continuing sync
  // relationship this generator refuses. `apps/web/nuxt.config.ts` is not a
  // managed target, so this is asserting an existing boundary still holds now
  // that the generator writes policy into that file.
  it('never re-imposes a scaffolded crawler policy or security contact', async () => {
    const targetDir = await scaffold()
    const generated = await read(targetDir, 'apps/web/nuxt.config.ts')
    expect(generated, 'the fixture scaffolds the policy this test protects').toContain(
      "aiCrawlers: 'allow',",
    )

    await edit(targetDir, 'apps/web/nuxt.config.ts', (contents) =>
      contents.replace(
        "aiCrawlers: 'allow',",
        "aiCrawlers: 'disallow',\n    securityTxt: { contact: 'mailto:app-owned@example.test' },",
      ),
    )
    const edited = await read(targetDir, 'apps/web/nuxt.config.ts')

    const report = await upgradeNardukApp({ targetDir })

    expect(await read(targetDir, 'apps/web/nuxt.config.ts')).toBe(edited)
    expect(statusOf(report, 'apps/web/nuxt.config.ts')).toBe('missing-from-report')
    expect(report.driftCount).toBe(0)
  })

  it('refreshes managed units and leaves app-owned content untouched', async () => {
    const targetDir = await scaffold()
    const pristine = {
      copilot: await read(targetDir, '.github/workflows/copilot-setup-steps.yml'),
      dependabot: await read(targetDir, '.github/dependabot.yml'),
    }

    // Managed drift: a stale shared-workflow pin, a gutted contract script,
    // a stale router paragraph, and two files rolled back wholesale.
    await edit(targetDir, '.github/workflows/ci.yml', (contents) =>
      contents.replace(
        /nuxt-cloudflare\.yml@[0-9a-f]{40}/u,
        'nuxt-cloudflare.yml@' + '0'.repeat(40),
      ),
    )
    await edit(targetDir, 'package.json', (contents) =>
      contents.replace(
        /"foundation:check": "[^"]*"/u,
        '"foundation:check": "narduk-app foundation:check"',
      ),
    )
    await edit(targetDir, 'AGENTS.md', (contents) =>
      contents.replace(/^Every shareable route.*$/mu, 'Stale router sentence.'),
    )
    await edit(targetDir, '.github/workflows/copilot-setup-steps.yml', () => 'name: Stale\n')
    await edit(targetDir, '.github/dependabot.yml', () => 'version: 2\n')

    // App-owned content the codemod must preserve, in each managed file.
    await edit(
      targetDir,
      '.github/workflows/ci.yml',
      (contents) => contents + '\n# app-owned: this repo runs one extra browser shard\n',
    )
    await edit(
      targetDir,
      'AGENTS.md',
      (contents) => contents + '\n## Marine domain\n\nApp prose.\n',
    )
    await edit(targetDir, 'package.json', (contents) =>
      contents.replace(
        '  "scripts": {\n',
        '  "scripts": {\n    "marine:ingest": "node bin/x.mjs",\n',
      ),
    )
    const appOwnedDoc = '# E2E Testing\n\nThis app replaced the generated layout.\n'
    await writeFile(join(targetDir, 'docs/e2e-testing.md'), appOwnedDoc, 'utf8')

    const dryRun = await upgradeNardukApp({ targetDir })
    expect(dryRun.driftCount).toBe(5)
    expect(await read(targetDir, '.github/dependabot.yml')).toBe('version: 2\n')

    const applied = await upgradeNardukApp({ targetDir, write: true })
    expect(applied.mode).toBe('write')
    expect(applied.changes.filter((change) => change.applied)).toHaveLength(5)

    // Managed units are refreshed...
    expect(await read(targetDir, '.github/workflows/ci.yml')).toContain(
      'nuxt-cloudflare.yml@1513b2a2f4b147b2e625478e56eb9de0cc5d5399',
    )
    expect(await read(targetDir, '.github/workflows/copilot-setup-steps.yml')).toBe(
      pristine.copilot,
    )
    expect(await read(targetDir, '.github/dependabot.yml')).toBe(pristine.dependabot)
    expect(await read(targetDir, 'AGENTS.md')).toContain('Every shareable route needs a preview.')
    expect(await read(targetDir, 'package.json')).toContain('mkdir -p foundation-check')

    // ...and every app-owned byte survives.
    expect(await read(targetDir, '.github/workflows/ci.yml')).toContain(
      '# app-owned: this repo runs one extra browser shard',
    )
    expect(await read(targetDir, 'AGENTS.md')).toContain('## Marine domain')
    expect(await read(targetDir, 'AGENTS.md')).toContain('App prose.')
    expect(await read(targetDir, 'package.json')).toContain('"marine:ingest": "node bin/x.mjs"')
    expect(await read(targetDir, 'package.json')).toContain('"quality:static"')
    // Seeded: not in the managed table, so upgrade never reads or writes it.
    expect(await read(targetDir, 'docs/e2e-testing.md')).toBe(appOwnedDoc)
  })

  it('is idempotent: a second write run reports no drift', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, '.github/workflows/copilot-setup-steps.yml', () => 'name: Stale\n')
    await edit(targetDir, 'package.json', (contents) =>
      contents.replace(/"build:ci": "[^"]*"/u, '"build:ci": "pnpm run build"'),
    )

    const first = await upgradeNardukApp({ targetDir, write: true })
    expect(first.changes.filter((change) => change.applied).length).toBeGreaterThan(0)

    const second = await upgradeNardukApp({ targetDir, write: true })
    expect(second.driftCount).toBe(0)
    expect(second.changes.every((change) => change.applied)).toBe(false)

    const third = await upgradeNardukApp({ targetDir })
    expect(third.driftCount).toBe(0)
  })

  it('never removes an app script and never reorders the manifest', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, 'package.json', (contents) =>
      contents
        .replace(/"manifests:validate": "[^"]*",\n/u, '')
        .replace('  "scripts": {\n', '  "scripts": {\n    "zz:app": "echo app",\n'),
    )

    const before = JSON.parse(await read(targetDir, 'package.json'))
    await upgradeNardukApp({ targetDir, write: true })
    const after = JSON.parse(await read(targetDir, 'package.json'))

    expect(after.scripts['manifests:validate']).toBe('pnpm --filter web run manifests:validate')
    expect(after.scripts['zz:app']).toBe('echo app')
    // Everything outside the managed script keys is byte-for-byte the same object.
    for (const key of MANAGED_SCRIPT_KEYS) {
      delete before.scripts[key]
      delete after.scripts[key]
    }
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })

  it('keeps an app-authored manifests:validate body: the name is the contract (#468)', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, 'package.json', (contents) =>
      contents
        .replace(
          /"manifests:validate": "[^"]*"/u,
          '"manifests:validate": "pnpm run contract:check"',
        )
        .replace(/"build:ci": "[^"]*"/u, '"build:ci": "pnpm run build"'),
    )
    const before = await read(targetDir, 'package.json')

    const report = await upgradeNardukApp({ targetDir, write: true })
    const after = JSON.parse(await read(targetDir, 'package.json'))

    expect(after.scripts['manifests:validate']).toBe('pnpm run contract:check')
    // A body-owned key beside it is still restored, so the manifest was edited.
    expect(after.scripts['build:ci']).not.toBe('pnpm run build')
    expect(report.changes.find((entry) => entry.path === 'package.json')?.detail).not.toContain(
      'manifests:validate',
    )
    expect(await read(targetDir, 'package.json')).not.toBe(before)
  })

  it('treats an empty manifests:validate body as missing and fills it', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, 'package.json', (contents) =>
      contents.replace(/"manifests:validate": "[^"]*"/u, '"manifests:validate": " "'),
    )

    await upgradeNardukApp({ targetDir, write: true })
    const after = JSON.parse(await read(targetDir, 'package.json'))
    expect(after.scripts['manifests:validate']).toBe('pnpm --filter web run manifests:validate')
  })

  it('restores a Prettier-wrapped script entry to the generated manifest byte for byte', async () => {
    const targetDir = await scaffold()
    const pristine = await read(targetDir, 'package.json')
    // Prettier wraps a long entry onto its own line; the edit has to find the
    // whole span, not a single line, and put the canonical rendering back.
    await edit(targetDir, 'package.json', (contents) =>
      contents.replace(
        /"foundation:check": "[^"]*"/u,
        '"foundation:check":\n      "narduk-app foundation:check"',
      ),
    )

    await upgradeNardukApp({ targetDir, write: true })
    expect(await read(targetDir, 'package.json')).toBe(pristine)
  })

  it('refuses to touch a manifest whose scripts block it cannot edit in place', async () => {
    const targetDir = await scaffold()
    // Valid JSON, but the scripts object is inline: rewriting a key here would
    // mean re-rendering the manifest, so the codemod reports instead.
    const inline = JSON.stringify({ name: 'inline-app', scripts: { 'build:ci': 'nope' } })
    await writeFile(join(targetDir, 'package.json'), inline, 'utf8')

    const report = await upgradeNardukApp({ targetDir, write: true })
    const change = report.changes.find((entry) => entry.path === 'package.json')
    expect(change?.status).toBe('unresolved')
    expect(change?.applied).toBe(false)
    expect(await read(targetDir, 'package.json')).toBe(inline)
  })
})

describe('upgrade opt-outs and notices', () => {
  it('honours a narduk:unmanaged header and does not count it as drift', async () => {
    const targetDir = await scaffold()
    const disowned = '# narduk:unmanaged\nversion: 2\n'
    await writeFile(join(targetDir, '.github/dependabot.yml'), disowned, 'utf8')

    const report = await upgradeNardukApp({ targetDir, write: true })
    expect(statusOf(report, '.github/dependabot.yml')).toBe('unmanaged')
    expect(report.driftCount).toBe(0)
    expect(await read(targetDir, '.github/dependabot.yml')).toBe(disowned)
  })

  it('refreshes the e2e flake policy without touching the rest of the document', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, 'docs/e2e-testing.md', (contents) =>
      contents
        .replace(/`retries`: 1 in CI, 0 locally\./u, '`retries`: whatever, honestly.')
        .replace(
          '# E2E Testing\n',
          '# E2E Testing\n\nThis app runs its suite through a wrapper.\n',
        ),
    )
    const before = await read(targetDir, 'docs/e2e-testing.md')
    expect(before).toContain('This app runs its suite through a wrapper.')

    const report = await upgradeNardukApp({ targetDir, write: true })
    expect(statusOf(report, 'docs/e2e-testing.md')).toBe('drift')

    const after = await read(targetDir, 'docs/e2e-testing.md')
    expect(after).toContain('`retries`: 1 in CI, 0 locally.')
    expect(after).not.toContain('whatever, honestly')
    // The app's own prose, outside the markers, is untouched.
    expect(after).toContain('This app runs its suite through a wrapper.')
  })

  it('treats a missing router region as an opt-in notice, not drift', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, 'AGENTS.md', (contents) =>
      contents
        .replace(REGION_MARKERS.agentsRouter.start + '\n', '')
        .replace(REGION_MARKERS.agentsRouter.end + '\n', ''),
    )

    const report = await upgradeNardukApp({ targetDir })
    expect(statusOf(report, 'AGENTS.md')).toBe('unmanaged')
    expect(report.driftCount).toBe(0)
  })

  it('treats an app e2e document with no policy markers as an opt-in notice', async () => {
    const targetDir = await scaffold()
    await writeFile(
      join(targetDir, 'docs/e2e-testing.md'),
      '# E2E Testing\n\nThis app replaced the generated layout entirely.\n',
      'utf8',
    )

    const report = await upgradeNardukApp({ targetDir, write: true })
    expect(statusOf(report, 'docs/e2e-testing.md')).toBe('unmanaged')
    expect(report.driftCount).toBe(0)
    expect(await read(targetDir, 'docs/e2e-testing.md')).toContain('replaced the generated layout')
  })

  it('reports an absent pin host rather than scaffolding one', async () => {
    const targetDir = await scaffold()
    await rm(join(targetDir, '.github/workflows/ci.yml'))
    await edit(targetDir, 'AGENTS.md', (contents) => contents)

    const report = await upgradeNardukApp({ targetDir })
    expect(statusOf(report, '.github/workflows/ci.yml')).toBe('absent')
    expect(report.driftCount).toBe(0)
  })

  it('creates a managed file that is missing entirely', async () => {
    const targetDir = await scaffold()
    await rm(join(targetDir, '.github/dependabot.yml'))

    const report = await upgradeNardukApp({ targetDir, write: true })
    expect(statusOf(report, '.github/dependabot.yml')).toBe('create')
    expect(await read(targetDir, '.github/dependabot.yml')).toContain("package-ecosystem: 'npm'")
  })
})

describe('upgrade profile inference', () => {
  it('reads the app back out of its own manifests', async () => {
    const targetDir = await scaffold({
      capabilities: 'seo,analytics,mapkit',
      databaseBackend: 'd1',
    })
    const profile = await inferUpgradeProfile(targetDir)

    expect(profile.appName).toBe('upgrade-fixture')
    expect(profile.capabilities).toEqual(['seo', 'analytics', 'mapkit'])
    expect(profile.databaseBackend).toBe('d1')
    expect(profile.visibility).toBe('private')
    expect(profile.inferred).toContain('databaseBackend')
  })

  it('detects a database-free app from its nuxt config', async () => {
    const targetDir = await scaffold({ capabilities: 'seo', databaseBackend: 'none' })
    const profile = await inferUpgradeProfile(targetDir)

    expect(profile.databaseBackend).toBe('none')
    // The migrate scripts are not emitted for this profile, so they are not
    // managed -- and an app that has them anyway keeps them.
    const report = await upgradeNardukApp({ targetDir })
    expect(report.driftCount).toBe(0)
  })

  it('drops an impossible auth+no-database reading instead of throwing', async () => {
    const targetDir = await scaffold({ capabilities: 'seo', databaseBackend: 'none' })
    const profile = await inferUpgradeProfile(targetDir, { capabilities: 'auth,seo' })

    expect(profile.capabilities).toEqual(['seo'])
    expect(profile.notes.join(' ')).toContain('auth')
  })

  it('keeps every managed unit independent of the cosmetic options', async () => {
    const targetDir = await scaffold()
    const baseline = await upgradeNardukApp({ targetDir })
    expect(baseline.driftCount).toBe(0)

    // displayName, description and siteUrl are not inferred at all. Proving no
    // managed unit depends on them is what makes that omission safe.
    await edit(targetDir, 'package.json', (contents) =>
      contents.replace('"name": "upgrade-fixture"', '"name": "renamed-app"'),
    )
    const renamed = await upgradeNardukApp({ targetDir })
    expect(renamed.profile.appName).toBe('renamed-app')
    expect(renamed.driftCount).toBe(0)
  })
})

describe('upgrade CLI', () => {
  async function runUpgrade(
    argv: readonly string[],
  ): Promise<{ code: number; out: string; err: string }> {
    let out = ''
    let err = ''
    const sink = (append: (value: string) => void): Writable =>
      new Writable({
        write(chunk, _encoding, callback) {
          append(String(chunk))
          callback()
        },
      })
    const code = await runCli({
      argv,
      stderr: sink((value) => (err += value)),
      stdout: sink((value) => (out += value)),
    })
    return { code, err, out }
  }

  it('exits 1 on drift in a dry run and 0 once written', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, '.github/dependabot.yml', () => 'version: 2\n')

    const dry = await runUpgrade(['upgrade', targetDir])
    expect(dry.code).toBe(1)
    expect(dry.out).toContain('--- a/.github/dependabot.yml')
    expect(dry.out).toContain('re-run with --write to apply')
    // A dry run is a check: it must not have touched anything.
    expect(await read(targetDir, '.github/dependabot.yml')).toBe('version: 2\n')

    const written = await runUpgrade(['upgrade', targetDir, '--write'])
    expect(written.code).toBe(0)
    expect(await runUpgrade(['upgrade', targetDir])).toMatchObject({ code: 0 })
  })

  it('exits 0 when a generated app has no drift', async () => {
    const targetDir = await scaffold()
    const result = await runUpgrade(['upgrade', targetDir, '--json'])

    expect(result.code).toBe(0)
    const report = JSON.parse(result.out) as UpgradeReport
    expect(report.schemaVersion).toBe(1)
    expect(report.mode).toBe('dry-run')
    expect(report.driftCount).toBe(0)
  })

  it('limits the run to the paths named by --only', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, '.github/dependabot.yml', () => 'version: 2\n')
    await edit(targetDir, '.github/workflows/copilot-setup-steps.yml', () => 'name: Stale\n')

    const result = await runUpgrade([
      'upgrade',
      targetDir,
      '--only',
      '.github/dependabot.yml',
      '--write',
    ])
    expect(result.code).toBe(0)
    expect(await read(targetDir, '.github/dependabot.yml')).toContain("package-ecosystem: 'npm'")
    expect(await read(targetDir, '.github/dependabot.yml')).not.toContain('registries:')
    expect(await read(targetDir, '.github/workflows/copilot-setup-steps.yml')).toBe('name: Stale\n')
  })

  it('rejects an --only path that is not a managed unit', async () => {
    const targetDir = await scaffold()
    const result = await runUpgrade(['upgrade', targetDir, '--only', 'README.md'])

    expect(result.code).toBe(1)
    expect(result.err).toContain('--only must name a managed path')
    expect(result.out).toBe('')
  })

  it('documents every managed unit in --help', async () => {
    const result = await runUpgrade(['--help'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('create-narduk-app upgrade [dir] [options]')
    for (const target of MANAGED_TARGETS) expect(result.out).toContain(target.path)
  })

  it('still generates an app when the first argument is not "upgrade"', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'create-narduk-upgrade-cli-'))
    tempDirectories.push(directory)
    const result = await runUpgrade([
      'not-upgrade',
      '--target-dir',
      join(directory, 'app'),
      '--no-git',
    ])

    expect(result.code).toBe(0)
    expect(result.out).toContain('Created not-upgrade')
  })
})

describe('unified diff rendering', () => {
  it('returns nothing for identical input', () => {
    expect(unifiedDiff('a.txt', 'one\ntwo\n', 'one\ntwo\n')).toBe('')
  })

  it('renders hunks with headers, context and both change markers', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n') + '\n'
    const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g'].join('\n') + '\n'
    const diff = unifiedDiff('sample.txt', before, after)

    expect(diff.startsWith('--- a/sample.txt\n+++ b/sample.txt\n')).toBe(true)
    expect(diff).toContain('@@ -1,7 +1,7 @@')
    expect(diff).toContain('-d')
    expect(diff).toContain('+D')
    expect(diff).toContain(' c')
    // Only one hunk: a seven-line file is entirely inside the context window.
    expect(diff.match(/^@@/gmu)).toHaveLength(1)
  })

  it('splits distant changes into separate hunks', () => {
    const lines = Array.from({ length: 40 }, (_, index) => 'line ' + index)
    const changed = [...lines]
    changed[1] = 'changed top'
    changed[38] = 'changed bottom'
    const diff = unifiedDiff('sample.txt', lines.join('\n') + '\n', changed.join('\n') + '\n')

    expect(diff.match(/^@@/gmu)).toHaveLength(2)
  })
})

describe('upgrade report formatting', () => {
  it('names the profile, every unit and the drift verdict', async () => {
    const targetDir = await scaffold()
    await edit(targetDir, '.github/dependabot.yml', () => 'version: 2\n')
    const text = formatUpgradeReport(await upgradeNardukApp({ targetDir }))

    expect(text).toContain('Profile: upgrade-fixture · private · database d1')
    for (const target of MANAGED_TARGETS) expect(text).toContain(target.path)
    expect(text).toContain('Drift in 1 of ' + MANAGED_TARGETS.length + ' managed unit(s)')
    expect(text).toContain('lines)')
  })
})
