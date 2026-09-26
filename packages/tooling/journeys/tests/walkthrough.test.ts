import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { digestJourney } from '../src/digest.js'
import type { RunManifest } from '../src/types.js'
import { runPaths } from '../src/verify.js'
import { buildWalkthrough } from '../src/walkthrough.js'
import {
  attemptFiles,
  catalog,
  passedCaptureManifest,
  webJourney,
  writeAttempt,
} from './helpers.js'
import { tempDir } from './fixtures/temp-dir.js'

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
    const outRoot = tempDir('njr-out-')
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
    const outRoot = tempDir('njr-out-')
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
    const outRoot = tempDir('njr-out-')
    promoted(outRoot, (manifest) => {
      manifest.declarationDigest = 'sha256:older'
    })
    expect(() => buildWalkthrough(catalog(), options(outRoot))).toThrow(/stale run/)
  })

  it('does not refuse a promoted capture as stale when a sibling journey is added (#66)', () => {
    const outRoot = tempDir('njr-out-')
    const first = webJourney()
    promoted(outRoot, (manifest) => {
      manifest.journeyDigest = digestJourney(first)
    })
    const two = catalog()
    two.journeys.push(webJourney({ id: 'second-journey' }))
    const { missing } = buildWalkthrough(two, {
      ...options(outRoot),
      currentDigest: 'sha256:after-sibling',
    })
    expect(missing).toEqual(['second-journey: no promoted capture run'])
  })

  it('refuses mixed application revisions without the explicit override', () => {
    const outRoot = tempDir('njr-out-')
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

  it('lets two surfaces carry their own revision, environment and profile', () => {
    // A web app and a phone app are two applications with two version schemes,
    // and their runs file under different environments by construction. Making
    // a cross-surface page demand the mixed-revision override every time would
    // turn the guard into noise, which is how a guard stops being read.
    const outRoot = tempDir('njr-out-')
    const both = catalog()
    both.profiles.handset = { kind: 'apple', device: 'iPhone 16 Pro' }
    both.journeys.push({
      id: 'phone-journey',
      title: 'On the phone',
      surface: 'ios',
      drive: 'driven',
      role: 'visitor',
      scenarios: ['base'],
      outcome: 'The same load, in a hand.',
      launchArgs: [],
      start: { screen: 'the yard', requires: ['yard'] },
      steps: [
        {
          id: 'open-start',
          say: 'Open the start page',
          press: { kind: 'tap', x: 10, y: 10 },
          lands: { screen: 'start', requires: ['start'] },
        },
        {
          id: 'finish',
          say: 'Press Finish',
          press: { kind: 'tap', x: 10, y: 20 },
          lands: { screen: 'done', requires: ['done'] },
        },
      ],
    })
    promoted(outRoot)
    const phone = passedCaptureManifest(DIGEST)
    phone.journey = 'phone-journey'
    phone.surface = 'ios'
    phone.appRevision = 'ios-0.2.0-18'
    phone.profile = { name: 'handset', device: 'iPhone 16 Pro' }
    const paths = runPaths({
      outRoot,
      environment: 'handset-fixture',
      surface: 'ios',
      journeyId: 'phone-journey',
      profileName: 'handset',
      mode: 'capture',
      runId: 'run-1',
    })
    writeAttempt(paths.attemptDirectory, phone, attemptFiles)
    writeFileSync(paths.latestPath, 'run-1\n')

    const { written, missing } = buildWalkthrough(both, {
      ...options(outRoot),
      environments: { ios: 'handset-fixture' },
      profileNames: { ios: 'handset' },
    })
    expect(missing).toEqual([])
    const html = readFileSync(written, 'utf8')
    expect(html).toContain('On the phone')
    expect(html).toContain('ios-0.2.0-18')
    expect(html).toContain('fixture-r1')
  })
})
