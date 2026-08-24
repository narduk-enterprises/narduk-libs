import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { RunManifest } from '../src/types.js'
import { runPaths } from '../src/verify.js'
import { buildWalkthrough } from '../src/walkthrough.js'
import { attemptFiles, catalog, passedCaptureManifest, writeAttempt } from './helpers.js'

const DIGEST = 'sha256:current'

function promoted(outRoot: string, mutate: (m: RunManifest) => void = () => {}, mode = 'capture') {
  const manifest = passedCaptureManifest(DIGEST)
  mutate(manifest)
  const paths = runPaths({
    outRoot,
    environment: 'fixture',
    surface: 'web',
    journeyId: manifest.journey,
    profileName: 'desktop',
    mode: mode as 'capture' | 'test',
    runId: 'run-1',
  })
  writeAttempt(paths.attemptDirectory, manifest, manifest.mode === 'capture' ? attemptFiles : {})
  mkdirSync(paths.modeDirectory, { recursive: true })
  writeFileSync(paths.latestPath, 'run-1\n')
  return paths
}

function options(outRoot: string) {
  return {
    outRoot,
    environment: 'fixture',
    profileName: 'desktop',
    currentDigest: DIGEST,
    destination: join(outRoot, 'walkthrough'),
  }
}

describe('buildWalkthrough', () => {
  it('builds from a promoted capture run and reports journeys with none', () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'njr-out-'))
    promoted(outRoot)
    const twoJourneys = catalog()
    twoJourneys.journeys.push({ ...twoJourneys.journeys[0]!, id: 'second-journey' })
    const { written, missing } = buildWalkthrough(twoJourneys, options(outRoot))
    const html = readFileSync(written, 'utf8')
    expect(html).toContain('Open the start page')
    expect(html).toContain('steps/01-open-start.png')
    expect(missing).toEqual(['second-journey: no promoted capture run'])
  })

  it('refuses a test-mode latest — a walkthrough never consumes a run with no media', () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'njr-out-'))
    promoted(
      outRoot,
      (manifest) => {
        manifest.mode = 'test'
        for (const step of manifest.steps) {
          delete step.shot
          delete step.shotSha256
        }
        delete manifest.video
      },
      'capture',
    )
    expect(() => buildWalkthrough(catalog(), options(outRoot))).toThrow(/not a capture run/)
  })

  it('refuses a stale promoted run at build time', () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'njr-out-'))
    promoted(outRoot, (manifest) => {
      manifest.declarationDigest = 'sha256:older'
    })
    expect(() => buildWalkthrough(catalog(), options(outRoot))).toThrow(/stale run/)
  })

  it('refuses mixed application revisions without the explicit override', () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'njr-out-'))
    const mixed = catalog()
    mixed.journeys.push({ ...mixed.journeys[0]!, id: 'second-journey' })
    promoted(outRoot)
    const manifest = passedCaptureManifest(DIGEST)
    manifest.journey = 'second-journey'
    manifest.appRevision = 'fixture-r2'
    const paths = runPaths({
      outRoot,
      environment: 'fixture',
      surface: 'web',
      journeyId: 'second-journey',
      profileName: 'desktop',
      mode: 'capture',
      runId: 'run-1',
    })
    writeAttempt(paths.attemptDirectory, manifest, attemptFiles)
    writeFileSync(paths.latestPath, 'run-1\n')
    expect(() => buildWalkthrough(mixed, options(outRoot))).toThrow(/one revision, not a collage/)
    expect(() =>
      buildWalkthrough(mixed, { ...options(outRoot), allowMixedAppRevision: true }),
    ).not.toThrow()
  })
})
