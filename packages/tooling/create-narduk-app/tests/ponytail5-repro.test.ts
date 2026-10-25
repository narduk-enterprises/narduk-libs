import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import * as YAML from 'yaml'

import { buildGeneratedFiles, createNardukApp, upgradeNardukApp } from '../src/index.js'
import { NUXT_CLOUDFLARE_WORKFLOW_SHA } from '../src/workflow-pin.js'

const CI = '.github/workflows/ci.yml'
const OLD_PIN = '8192f3ddb0d383a06316542bb36cc847ab0c6895'

const tempDirectories: string[] = []
afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('ponytail5 #3 upgrade --write with an unresolved caller permission', () => {
  it('does not move the CI pin when the caller grants pull-requests: read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ponytail5-'))
    tempDirectories.push(directory)
    const targetDir = join(directory, 'app')
    await createNardukApp({
      appName: 'ponytail5-fixture',
      capabilities: 'seo,analytics',
      noGit: true,
      targetDir,
      visibility: 'private',
    })
    const before = await readFile(join(targetDir, CI), 'utf8')
    const stale = before
      .replaceAll(NUXT_CLOUDFLARE_WORKFLOW_SHA, OLD_PIN)
      .replace('      pull-requests: write\n', '      pull-requests: read\n')
    expect(stale).not.toBe(before)
    await writeFile(join(targetDir, CI), stale, 'utf8')

    await upgradeNardukApp({ targetDir, write: true })

    const after = await readFile(join(targetDir, CI), 'utf8')
    // A caller granting less than the pinned workflow needs gets startup_failure.
    // If the grant cannot be widened, the pin must not move under it.
    const movedPin = after.includes(NUXT_CLOUDFLARE_WORKFLOW_SHA)
    const stillNarrow = after.includes('pull-requests: read')
    expect({ movedPin, stillNarrow }).not.toEqual({ movedPin: true, stillNarrow: true })
  })
})

describe('ponytail5 #4 dependabot npm PR budget', () => {
  it('allows one PR per lane (safe + majors)', () => {
    const files = buildGeneratedFiles({
      appName: 'ponytail5-fixture',
      capabilities: ['seo', 'analytics'],
      noGit: true,
      targetDir: '/tmp/ponytail5-fixture',
    } as never)
    const file = files.find((entry) => entry.path === '.github/dependabot.yml')
    const dependabot = YAML.parse(file?.contents ?? '') as {
      updates: Array<{ 'package-ecosystem': string; 'open-pull-requests-limit'?: number }>
    }
    const npm = dependabot.updates.find((update) => update['package-ecosystem'] === 'npm')
    expect(npm?.['open-pull-requests-limit']).toBe(2)
  })
})
