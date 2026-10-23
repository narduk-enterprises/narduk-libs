import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import type { Page } from '@playwright/test'

import { resolveInjector } from '../src/apple-control.js'
import { defineCatalog } from '../src/define.js'
import { digestJourney } from '../src/digest.js'
import { promoteRun, verifyRun } from '../src/verify.js'
import { createContextApi } from '../src/web.js'
import {
  attemptFiles,
  catalog,
  passedCaptureManifest,
  webJourney,
  writeAttempt,
} from './helpers.js'

const DIGEST = 'sha256:current'
const tmp = () => mkdtempSync(join(tmpdir(), 'p5-'))

describe('ponytail-5 regressions', () => {
  it('#1 verify must not hash a file outside the attempt directory', () => {
    const root = tmp()
    const old = join(root, 'OLD')
    writeAttempt(old, passedCaptureManifest(DIGEST), attemptFiles)
    const fresh = join(root, 'NEW')
    mkdirSync(fresh, { recursive: true })
    const manifest = passedCaptureManifest(DIGEST)
    for (const step of manifest.steps) step.shot = `../OLD/${step.shot}`
    if (manifest.video) manifest.video.file = '../OLD/video.mp4'
    writeAttempt(fresh, manifest, {})
    expect(verifyRun(catalog(), manifest, fresh, { currentDigest: DIGEST })).not.toEqual([])
  })

  it('#1b promote must not write a traversing run id into latest', () => {
    const dir = tmp()
    const manifest = passedCaptureManifest(DIGEST)
    writeAttempt(dir, manifest, attemptFiles)
    const latest = join(dir, 'latest')
    let threw = false
    try {
      promoteRun(catalog(), manifest, dir, {
        currentDigest: DIGEST,
        runId: '../other',
        latestPath: latest,
      })
    } catch {
      threw = true
    }
    expect(threw, 'promote accepted runId ../other').toBe(true)
  })

  it('#2 a single made-up step id "open-start finish" must not stand in for two', () => {
    const dir = tmp()
    const manifest = passedCaptureManifest(DIGEST)
    manifest.steps = [{ ...manifest.steps[0]!, id: 'open-start finish' }]
    writeAttempt(dir, manifest, attemptFiles)
    expect(verifyRun(catalog(), manifest, dir, { currentDigest: DIGEST })).not.toEqual([])
  })

  it('#3 semicolon removal must not collide different statements', () => {
    const withBody = (source: string) => {
      const run = async () => {}
      run.toString = () => source
      return webJourney({ id: 'walk', steps: [{ id: 'fill', say: 'Fill', do: run }] })
    }
    expect(digestJourney(withBody('async () => { return 1;+2 }'))).not.toBe(
      digestJourney(withBody('async () => { return 1+2 }')),
    )
    expect(digestJourney(withBody('async () => { const x = a;\n+ b }'))).not.toBe(
      digestJourney(withBody('async () => { const x = a\n+ b }')),
    )
    expect(digestJourney(withBody('async () => { x = a;`t` }'))).not.toBe(
      digestJourney(withBody('async () => { x = a`t` }')),
    )
    expect(digestJourney(withBody('async () => { x = a;/r/.test(b) }'))).not.toBe(
      digestJourney(withBody('async () => { x = a/r/.test(b) }')),
    )
  })

  it('#8 must() passes exact:true for a string name', async () => {
    const seen: Array<Record<string, unknown>> = []
    const locator: Record<string, unknown> = {
      nth: () => locator,
      count: async () => 1,
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      click: async () => {},
    }
    const page = {
      getByRole: (_role: string, opts: Record<string, unknown>) => {
        seen.push(opts)
        return locator
      },
      waitForTimeout: async () => {},
      mouse: { move: async () => {} },
    } as unknown as Page
    const api = createContextApi(page, 'http://x', 'test')
    await api.must('Cancel')
    expect(seen[0]).toMatchObject({ name: 'Cancel', exact: true })
  })

  it('#9 typed text with a space stays one argv element', () => {
    const dir = tmp()
    const script = join(dir, 'argv.js')
    const out = join(dir, 'argv.json')
    writeFileSync(
      script,
      `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))`,
    )
    const ok = `node ${script}`
    const injector = resolveInjector({
      udid: 'U1',
      templates: { tap: ok, swipe: ok, describe: ok, text: `${ok} --udid {udid} {text}`, key: ok },
      commandExists: () => false,
    })
    injector.type('Jane Doe')
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(['--udid', 'U1', 'Jane Doe'])
  })

  it('#20 defineCatalog rejects a scenario in which every step is skipped', () => {
    const bad = catalog({
      journeys: [
        webJourney({
          scenarios: ['base', 'extra'],
          steps: [
            { id: 'only-extra', say: 'X', skipWhen: { scenarios: ['base'] }, do: async () => {} },
          ],
        }),
      ],
    })
    expect(() => defineCatalog(bad)).toThrow()
  })
})
