import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { expectedStepIds, promoteRun, verifyRun } from '../src/verify.js'
import {
  attemptFiles,
  catalog,
  passedCaptureManifest,
  webJourney,
  writeAttempt,
} from './helpers.js'

const DIGEST = 'sha256:current'

function freshAttempt(
  manifestMutation: (m: ReturnType<typeof passedCaptureManifest>) => void = () => {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'njr-attempt-'))
  const manifest = passedCaptureManifest(DIGEST)
  manifestMutation(manifest)
  writeAttempt(directory, manifest, attemptFiles)
  return { directory, manifest }
}

describe('expectedStepIds', () => {
  it('resolves static skips per scenario', () => {
    const journey = webJourney({
      scenarios: ['base', 'extra'],
      steps: [
        { id: 'a', say: 'A', do: async () => {} },
        { id: 'b', say: 'B', skipWhen: { scenarios: ['extra'] }, do: async () => {} },
      ],
    })
    expect(expectedStepIds(journey, 'base')).toEqual(['a', 'b'])
    expect(expectedStepIds(journey, 'extra')).toEqual(['a'])
  })

  it('refuses a scenario the journey does not declare', () => {
    expect(() => expectedStepIds(webJourney(), 'extra')).toThrow(/does not declare/)
  })
})

describe('verifyRun', () => {
  it('passes a physically consistent capture attempt', () => {
    const { directory, manifest } = freshAttempt()
    expect(verifyRun(catalog(), manifest, directory, { currentDigest: DIGEST })).toEqual([])
  })

  it('fails a manifest that omitted a declared step — the manifest never specifies itself', () => {
    const { directory, manifest } = freshAttempt((m) => {
      m.steps = m.steps.slice(0, 1)
    })
    expect(verifyRun(catalog(), manifest, directory, { currentDigest: DIGEST })).toEqual([
      expect.stringContaining('does not equal declared'),
    ])
  })

  it('fails a shot whose hash does not match the file', () => {
    const { directory, manifest } = freshAttempt((m) => {
      const step = m.steps[0]
      if (step) step.shotSha256 = 'sha256:wrong'
    })
    expect(verifyRun(catalog(), manifest, directory, { currentDigest: DIGEST })).toEqual([
      expect.stringContaining('shot hash mismatch'),
    ])
  })

  it('fails a capture attempt with no video', () => {
    const { directory, manifest } = freshAttempt((m) => {
      delete m.video
    })
    expect(verifyRun(catalog(), manifest, directory, { currentDigest: DIGEST })).toEqual([
      expect.stringContaining('requires a video'),
    ])
  })

  it('fails a dynamic skip on a step that declares no appliesIf, and one with no reason', () => {
    const { directory, manifest } = freshAttempt((m) => {
      const step = m.steps[1]
      if (step) {
        step.status = 'skipped-not-applicable'
        delete step.shot
        delete step.shotSha256
      }
    })
    const issues = verifyRun(catalog(), manifest, directory, { currentDigest: DIGEST })
    expect(issues).toEqual([
      expect.stringContaining('declares no appliesIf'),
      expect.stringContaining('no recorded reason'),
    ])
  })

  it('fails a run whose world generation changed mid-run', () => {
    const { directory, manifest } = freshAttempt((m) => {
      m.scenario.generationAfter = 'ld-2'
    })
    expect(verifyRun(catalog(), manifest, directory, { currentDigest: DIGEST })).toEqual([
      expect.stringContaining('replaced under the journey'),
    ])
  })

  it('fails an internally consistent run against a changed declaration', () => {
    const { directory, manifest } = freshAttempt()
    expect(verifyRun(catalog(), manifest, directory, { currentDigest: 'sha256:changed' })).toEqual([
      expect.stringContaining('stale run'),
    ])
  })

  it('requires no artefacts of a test-mode run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'njr-attempt-'))
    const manifest = passedCaptureManifest(DIGEST)
    manifest.mode = 'test'
    for (const step of manifest.steps) {
      delete step.shot
      delete step.shotSha256
    }
    delete manifest.video
    writeAttempt(directory, manifest)
    expect(verifyRun(catalog(), manifest, directory, { currentDigest: DIGEST })).toEqual([])
  })
})

describe('promoteRun', () => {
  it('promotes a verified passed run atomically', () => {
    const { directory, manifest } = freshAttempt()
    const latestPath = join(directory, 'latest')
    promoteRun(catalog(), manifest, directory, {
      currentDigest: DIGEST,
      runId: 'run-1',
      latestPath,
    })
    expect(readFileSync(latestPath, 'utf8').trim()).toBe('run-1')
  })

  it('refuses a failed run and a stale declaration', () => {
    const { directory, manifest } = freshAttempt((m) => {
      m.verdict = 'failed'
    })
    expect(() =>
      promoteRun(catalog(), manifest, directory, {
        currentDigest: 'sha256:changed',
        runId: 'run-1',
        latestPath: join(directory, 'latest'),
      }),
    ).toThrow(/refusing to promote[\s\S]*stale run[\s\S]*only a passed run/)
  })
})
