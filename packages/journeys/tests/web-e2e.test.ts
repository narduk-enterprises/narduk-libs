/**
 * The engine spike (spec §13.2), executable: the ./web adapter drives a real
 * headless Chromium against the fixture world, in both modes, through the
 * BUILT package — the artifact a consumer installs — and the declaration-
 * derived verifier passes what ran and fails what broke.
 */
import { execFile, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { digestDirectory } from '../src/digest.js'
import type { Catalog, RunManifest } from '../src/types.js'
import { promoteRun, readRunManifest, runPaths, verifyRun } from '../src/verify.js'
import { buildWalkthrough } from '../src/walkthrough.js'
import { createWorldServer } from './fixtures/server.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(packageRoot, 'tests/fixtures/pw-project')

let world: ReturnType<typeof createWorldServer>
let base = ''
let outRoot = ''
let digest = ''

const execFileAsync = promisify(execFile)

/**
 * Run the Playwright child WITHOUT blocking this process's event loop: the
 * fixture world server lives on it, and a sync exec would deadlock every
 * world fetch inside the child into its test timeout (found the hard way).
 */
async function playwright(
  env: Record<string, string>,
): Promise<{ status: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'pnpm',
      ['exec', 'playwright', 'test', '--config', 'tests/fixtures/pw-project/playwright.config.mjs'],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          NJR_BASE: base,
          NJR_OUT: outRoot,
          NJR_DIGEST: digest,
          NJR_PW_ARTIFACTS: join(outRoot, 'pw-artifacts'),
          ...env,
        },
      },
    )
    return { status: 0, output: `${stdout}${stderr}` }
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string }
    return { status: failed.code ?? 1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` }
  }
}

function attempt(
  journeyId: string,
  mode: 'test' | 'capture',
): { directory: string; manifest: RunManifest } {
  const paths = runPaths({
    outRoot,
    environment: 'fixture',
    surface: 'web',
    journeyId,
    profileName: 'desktop',
    mode,
    runId: 'unused',
  })
  const runsDir = join(paths.modeDirectory, 'runs')
  const runIds = readdirSync(runsDir)
  expect(runIds.length).toBeGreaterThan(0)
  const directory = join(runsDir, runIds[runIds.length - 1] as string)
  return { directory, manifest: readRunManifest(directory) }
}

beforeAll(async () => {
  execSync('pnpm run build', { cwd: packageRoot, stdio: 'ignore' })
  world = createWorldServer()
  base = await world.listen()
  outRoot = mkdtempSync(join(tmpdir(), 'njr-e2e-'))
  digest = digestDirectory(fixtureDir)
}, 120_000)

afterAll(async () => {
  await world?.close()
})

describe('the web adapter, end to end', () => {
  it(
    'runs every journey in test mode, parameterised across scenarios',
    { timeout: 180_000 },
    async () => {
      const run = await playwright({ JOURNEYS_MODE: 'test' })
      expect(run.output).toContain('happy-path')
      expect(run.status).toBe(0)

      const happy = attempt('happy-path', 'test')
      expect(happy.manifest.verdict).toBe('passed')
      expect(happy.manifest.scenario.confirmed).toBe(true)
      expect(happy.manifest.appRevision).toBe('fixture-r1')

      // flagged-extra ran under BOTH declared scenarios; under `extra` the probe
      // applied, under `base` it recorded the world fact as its skip reason.
      const flagged = attempt('flagged-extra', 'test')
      const catalogModule = readFileSync(join(fixtureDir, 'catalog.mjs'), 'utf8')
      expect(catalogModule).toContain('showExtra=false')
      const skipped = flagged.manifest.steps.find((step) => step.id === 'visit-extra')
      expect(skipped).toBeDefined()
    },
  )

  it(
    'captures with per-step shots, video, and a verifiable, promotable manifest',
    { timeout: 180_000 },
    async () => {
      const run = await playwright({ JOURNEYS_MODE: 'capture' })
      expect(run.status).toBe(0)

      const { directory, manifest } = attempt('happy-path', 'capture')
      expect(manifest.mode).toBe('capture')
      expect(manifest.steps.every((step) => step.status !== 'failed')).toBe(true)
      for (const step of manifest.steps.filter((candidate) => candidate.status === 'passed')) {
        expect(step.shot).toBeDefined()
        expect(existsSync(join(directory, step.shot as string))).toBe(true)
      }
      expect(manifest.video).toBeDefined()
      expect(existsSync(join(directory, manifest.video?.file as string))).toBe(true)
      expect(manifest.profile.name).toBe('desktop')

      const { catalog } = (await import(join(fixtureDir, 'catalog.mjs'))) as { catalog: Catalog }
      const issues = verifyRun(catalog, manifest, directory, { currentDigest: digest })
      expect(issues).toEqual([])

      const paths = runPaths({
        outRoot,
        environment: 'fixture',
        surface: 'web',
        journeyId: 'happy-path',
        profileName: 'desktop',
        mode: 'capture',
        runId: 'unused',
      })
      promoteRun(catalog, manifest, directory, {
        currentDigest: digest,
        runId: directory.split('/').pop() as string,
        latestPath: paths.latestPath,
      })

      const { written, missing } = buildWalkthrough(catalog, {
        outRoot,
        environment: 'fixture',
        profileName: 'desktop',
        currentDigest: digest,
        destination: join(outRoot, 'walkthrough'),
      })
      expect(readFileSync(written, 'utf8')).toContain('Press Finish and read the confirmation')
      expect(missing).toEqual(['flagged-extra: no promoted capture run'])
    },
  )

  it(
    'a renamed control is a red run that records its failure — never a green video',
    { timeout: 180_000 },
    async () => {
      const run = await playwright({ JOURNEYS_MODE: 'test', NJR_BROKEN: '1' })
      expect(run.status).not.toBe(0)
      const { manifest } = attempt('broken-selector', 'test')
      expect(manifest.verdict).toBe('failed')
      const failed = manifest.steps.find((step) => step.status === 'failed')
      expect(failed?.error).toContain('no button matching')
    },
  )
})
