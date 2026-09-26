import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createNardukApp, upgradeNardukApp } from '../src/index.js'
import {
  NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS,
  NUXT_CLOUDFLARE_WORKFLOW_SHA,
  rewriteWorkflowPins,
  workflowPinMove,
} from '../src/workflow-pin.js'

const GENERATOR_PIN = '1513b2a2f4b147b2e625478e56eb9de0cc5d5399'
const NEWER_APP_PIN = '94a3ba46994dd99e2b4b2ccdbf8b019cbe302745'
const CALLER = '.github/workflows/ci.yml'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function scaffold(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-narduk-pin-'))
  tempDirectories.push(directory)
  const targetDir = join(directory, 'app')
  await createNardukApp({
    appName: 'pin-fixture',
    capabilities: 'seo',
    noGit: true,
    targetDir,
  })
  return targetDir
}

async function read(targetDir: string, path: string): Promise<string> {
  return readFile(join(targetDir, path), 'utf8')
}

describe('workflow pin direction', () => {
  it('treats the generator pin as the newest entry in its own lineage', () => {
    expect(NUXT_CLOUDFLARE_WORKFLOW_SHA).toBe(GENERATOR_PIN)
    expect(NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS).not.toContain(GENERATOR_PIN)
    expect(workflowPinMove(GENERATOR_PIN, GENERATOR_PIN)).toBe('same')
  })

  it('moves an older generator pin forward and refuses a pin it did not ship', () => {
    const oldest = NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS[0] as string
    expect(workflowPinMove(oldest, GENERATOR_PIN)).toBe('forward')
    expect(workflowPinMove(NEWER_APP_PIN, GENERATOR_PIN)).toBe('refuse')
    expect(workflowPinMove(GENERATOR_PIN, oldest)).toBe('refuse')
  })

  it('rewrites a workflows@ comment onto the SHA it writes', () => {
    const source = [
      `uses: narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@${NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS[0]} # workflows@9070db72`,
      '',
    ].join('\n')
    const rewritten = rewriteWorkflowPins(source, GENERATOR_PIN)
    expect(rewritten).toContain(`nuxt-cloudflare.yml@${GENERATOR_PIN}`)
    expect(rewritten).toContain('workflows@1513b2a2')
    expect(rewritten).not.toContain('9070db72')
  })
})

describe('upgrade workflow pin', () => {
  it('does not re-pin a caller that is already on a newer SHA', async () => {
    const targetDir = await scaffold()
    const before = (await read(targetDir, CALLER))
      .replaceAll(GENERATOR_PIN, NEWER_APP_PIN)
      .replace(
        `nuxt-cloudflare.yml@${NEWER_APP_PIN}`,
        `nuxt-cloudflare.yml@${NEWER_APP_PIN} # workflows@94a3ba46`,
      )
    await writeFile(join(targetDir, CALLER), before, 'utf8')

    const report = await upgradeNardukApp({ only: [CALLER], targetDir, write: true })
    const change = report.changes.find((entry) => entry.path === CALLER)

    expect(change?.status).toBe('clean')
    expect(change?.diff).toBe('')
    expect(change?.applied).toBe(false)
    expect(await read(targetDir, CALLER)).toBe(before)
    expect(await read(targetDir, CALLER)).toContain(NEWER_APP_PIN)
    expect(await read(targetDir, CALLER)).not.toContain(GENERATOR_PIN)
  })

  it('moves a shipped ancestor pin forward and keeps the comment on that SHA', async () => {
    const targetDir = await scaffold()
    const ancestor = NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS[0] as string
    const before = (await read(targetDir, CALLER))
      .replaceAll(GENERATOR_PIN, ancestor)
      .replace(
        `nuxt-cloudflare.yml@${ancestor}`,
        `nuxt-cloudflare.yml@${ancestor} # workflows@${ancestor.slice(0, 8)}`,
      )
    await writeFile(join(targetDir, CALLER), before, 'utf8')

    const report = await upgradeNardukApp({ only: [CALLER], targetDir, write: true })
    const after = await read(targetDir, CALLER)

    expect(report.changes.find((entry) => entry.path === CALLER)?.status).toBe('drift')
    expect(after).toContain(`nuxt-cloudflare.yml@${GENERATOR_PIN}`)
    expect(after).toContain(`workflows@${GENERATOR_PIN.slice(0, 8)}`)
    expect(after).not.toContain(ancestor)
  })
})
