import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { AppleJourney, Catalog, RunManifest, WebJourney } from '../src/types.js'

export function webJourney(overrides: Partial<WebJourney> = {}): WebJourney {
  return {
    id: 'happy-path',
    title: 'Walk to the finish',
    surface: 'web',
    role: 'visitor',
    scenarios: ['base'],
    outcome: 'A visitor reaches the end.',
    steps: [
      { id: 'open-start', say: 'Open the start page', do: async () => {} },
      { id: 'finish', say: 'Press Finish', do: async () => {} },
    ],
    ...overrides,
  }
}

export function appleJourney(overrides: Partial<AppleJourney> = {}): AppleJourney {
  return {
    id: 'scan-to-ticket',
    title: 'Scan to ticket',
    surface: 'ios',
    role: 'visitor',
    scenarios: ['base'],
    outcome: 'One scan reaches a ticket.',
    binding: {
      xcTarget: 'FixtureUITests',
      xcClass: 'ScanJourneyUITests',
      xcMethod: 'testScanToTicket',
    },
    steps: [
      { id: 'open-scan', say: 'Open the scan tab' },
      { id: 'resolve', say: 'Resolve onto the job' },
    ],
    ...overrides,
  }
}

export function catalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    scenarios: [
      { id: 'base', name: 'The base world', blurb: 'Two rooms.' },
      { id: 'extra', name: 'The extra world', blurb: 'Three rooms.' },
    ],
    profiles: { desktop: { kind: 'web', viewport: { width: 1280, height: 800 } } },
    audience: { visitor: { credentialClass: 'public-synthetic' } },
    journeys: [webJourney()],
    ...overrides,
  }
}

export function sha256(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

/** Write a physically consistent capture attempt into `directory`. */
export function writeAttempt(
  directory: string,
  manifest: RunManifest,
  files: Record<string, string> = {},
): RunManifest {
  mkdirSync(directory, { recursive: true })
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(directory, relativePath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  writeFileSync(join(directory, 'run.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

export function passedCaptureManifest(digest: string): RunManifest {
  const shotContent = 'png-bytes-1'
  const videoContent = 'video-bytes'
  return {
    schema: 'njr-run/1',
    journey: 'happy-path',
    surface: 'web',
    mode: 'capture',
    base: 'http://fixture',
    commit: 'fixturecommit00',
    declarationDigest: digest,
    appRevision: 'fixture-r1',
    profile: { name: 'desktop', viewport: '1280x800' },
    startedAt: '2026-08-24T20:00:00.000Z',
    scenario: {
      id: 'base',
      confirmed: true,
      generation: 'ld-1',
      generationAfter: 'ld-1',
      preparedBy: 'fresh-load',
    },
    verdict: 'passed',
    steps: [
      {
        id: 'open-start',
        ordinal: 1,
        status: 'passed',
        say: 'Open the start page',
        startedMs: 0,
        endedMs: 900,
        shot: 'steps/01-open-start.png',
        shotSha256: sha256(shotContent),
      },
      {
        id: 'finish',
        ordinal: 2,
        status: 'passed',
        say: 'Press Finish',
        startedMs: 900,
        endedMs: 1800,
        shot: 'steps/02-finish.png',
        shotSha256: sha256(shotContent),
      },
    ],
    video: { file: 'video.mp4', seconds: 1.8, sha256: sha256(videoContent) },
  }
}

export const attemptFiles: Record<string, string> = {
  'steps/01-open-start.png': 'png-bytes-1',
  'steps/02-finish.png': 'png-bytes-1',
  'video.mp4': 'video-bytes',
}
