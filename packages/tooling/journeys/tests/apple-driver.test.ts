/**
 * The Apple orchestrator, proved against a fake simulator (narduk-libs#70).
 *
 * Everything here runs on a Linux CI runner: no Xcode, no simulator, no idb.
 * What it proves is the part that is ours — the sequencing, the landing
 * verification, the mode split, the manifests, and every refusal. The part that
 * is Apple's is proved by a live run on a Mac, and cannot be faked into being
 * true here.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  appleJourneyPlan,
  hashAppBundle,
  parseIdbElements,
  resolveInjector,
  runAppleJourneys,
} from '../src/apple.js'
import { sha256File } from '../src/media.js'
import type { AppleRunOptions, AppleWorldHooks } from '../src/apple.js'
import { defineCatalog } from '../src/define.js'
import type { AppleDrivenStep, Catalog, DrivenAppleJourney } from '../src/types.js'
import { promoteRun, runPaths, verifyRun } from '../src/verify.js'
import { buildWalkthrough } from '../src/walkthrough.js'
import { createFakeClock, createFakeDevice } from './fixtures/fake-simulator.js'
import type { FakeDeviceOptions } from './fixtures/fake-simulator.js'

const DIGEST = 'sha256:apple-fixture'

const YARD = 'PACC TRAC yard | SCHEDULED FOR TODAY | WCF-TT-21 | Expected today'
const SHEET = 'WCF-TT-21 | Expected today | planned for D | Mark arrived'
const ARRIVED = 'WCF-TT-21 | arrived | inbound staging | UNDO | Move to station'
const TICKET = 'Ticket #1893 | PRELIMINARY | 85 kg | share or print'
const YARD_AFTER = 'PACC TRAC yard | Station D | READY | outbound waiting for pickup'

/** The happy device: every beat's control goes where the declaration says. */
function screens(overrides: Partial<FakeDeviceOptions['screens']> = {}): FakeDeviceOptions {
  return {
    start: 'yard',
    screens: {
      yard: { tree: YARD, on: { 'tap:201,258': 'sheet' } },
      sheet: { tree: SHEET, on: { 'tap:201,795': 'arrived' } },
      arrived: { tree: ARRIVED, on: { 'tap:201,741': 'ticket' } },
      ticket: { tree: TICKET, on: { 'tap:45,80': 'yard-after' } },
      'yard-after': { tree: YARD_AFTER },
      ...overrides,
    },
  }
}

function journey(): DrivenAppleJourney {
  return {
    id: 'gate-to-gate',
    title: 'One load, gate to gate',
    surface: 'ios',
    drive: 'driven',
    role: 'operator',
    scenarios: ['walkthrough'],
    outcome: 'One trailer is walked from the gate to its ticket.',
    launchArgs: ['-uiProceduresOff', '1'],
    compromises: [
      {
        what: 'procedures are switched off for this walk',
        why: 'the board owns six of the eight signatures and a handset cannot sign them',
        cost: 'no checklist card appears in this recording',
      },
    ],
    start: { screen: 'the yard', requires: ['SCHEDULED FOR TODAY', 'WCF-TT-21'] },
    steps: [
      {
        id: 'open-sheet',
        say: 'Open the trailer that is due today',
        press: { kind: 'tap', x: 201, y: 258 },
        lands: { screen: 'the sheet', requires: ['Mark arrived'] },
      },
      {
        id: 'mark-arrived',
        say: 'Mark it arrived',
        press: { kind: 'tap', x: 201, y: 795 },
        lands: {
          screen: 'arrived, in inbound staging',
          requires: ['inbound staging'],
          forbids: ['SCHEDULED FOR TODAY'],
        },
        capture: { dwell: 5_500 },
      },
      {
        id: 'open-ticket',
        say: 'Open the ticket',
        press: { kind: 'tap', x: 201, y: 741 },
        lands: { screen: 'the ticket', requires: ['Ticket #1893', 'PRELIMINARY'] },
      },
      {
        id: 'back-to-yard',
        say: 'Come back to the yard',
        press: { kind: 'tap', x: 45, y: 80 },
        lands: {
          // The '‹ Yard' near-miss, declared: this control pops FURTHER than a
          // reader expects, so the beat says what it must and must not see.
          screen: 'the yard, with Station D ready',
          requires: ['Station D', 'READY'],
          forbids: ['Ticket #1893'],
        },
      },
    ],
  }
}

function fixtureCatalog(): Catalog {
  return defineCatalog({
    scenarios: [{ id: 'walkthrough', name: 'The walkthrough yard', blurb: 'One trailer, due.' }],
    profiles: {
      phone: { kind: 'apple', device: 'iPhone 16 Pro', points: { width: 402, height: 874 } },
    },
    audience: { operator: { credentialClass: 'public-synthetic', apple: { role: 'marcus' } } },
    journeys: [journey()],
  })
}

const world: AppleWorldHooks = {
  launchArgs: (scenarioId) => ['-uiFixtures', '1', '-uiScenario', scenarioId],
  appRevision: () => 'ios-build-18',
}

function fakeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'njr-app-'))
  const app = join(root, 'PaccTrac.app')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(app, 'Info.plist'), '<plist><dict/></plist>')
  writeFileSync(join(app, 'PaccTrac'), 'mach-o-bytes')
  return app
}

interface Harness {
  device: ReturnType<typeof createFakeDevice>
  options: AppleRunOptions
  outRoot: string
}

function harness(
  mode: 'test' | 'capture',
  deviceOptions: FakeDeviceOptions = screens(),
  overrides: Partial<AppleRunOptions> = {},
): Harness {
  const device = createFakeDevice(deviceOptions)
  const clock = createFakeClock()
  const outRoot = mkdtempSync(join(tmpdir(), 'njr-apple-out-'))
  return {
    device,
    outRoot,
    options: {
      catalog: fixtureCatalog(),
      world,
      control: device.control,
      injector: device.injector,
      appPath: fakeApp(),
      bundleId: 'com.narduk.pacctrac',
      outRoot,
      environment: 'fixture',
      profileName: 'phone',
      declarationDigest: DIGEST,
      commit: 'abc1234567',
      mode,
      settleTimeoutMs: 2_000,
      lease: { dir: mkdtempSync(join(tmpdir(), 'njr-lease-')) },
      throwOnFailure: false,
      now: clock.now,
      sleep: clock.sleep,
      ...overrides,
    },
  }
}

describe('the Apple adapter, driven', () => {
  it('walks every beat in test mode and writes a manifest the verifier accepts', async () => {
    const { options, device } = harness('test')
    const session = await runAppleJourneys(options)
    expect(session.failed).toBe(0)
    const [result] = session.results
    expect(result?.manifest.steps.map((step) => step.id)).toEqual([
      'open-sheet',
      'mark-arrived',
      'open-ticket',
      'back-to-yard',
    ])
    expect(result?.manifest.verdict).toBe('passed')
    // Requirement 1: the world came from launch arguments, scenario first.
    expect(device.log).toContain('launch:-uiFixtures 1 -uiScenario walkthrough -uiProceduresOff 1')
    // Requirement 4: the pinned binary, hashed, is in the evidence.
    expect(result?.manifest.profile.app).toEqual({
      path: options.appPath,
      sha256: hashAppBundle(options.appPath),
    })
    // A test-mode run carries no media, and the verifier agrees (§4.3).
    expect(result?.manifest.video).toBeUndefined()
    expect(device.recordings).toEqual([])
    expect(
      verifyRun(options.catalog, result!.manifest, result!.attemptDirectory, {
        currentDigest: DIGEST,
      }),
    ).toEqual([])
  })

  it('captures per-beat stills and a video, and promotes into a walkthrough', async () => {
    const { options, outRoot } = harness('capture')
    const session = await runAppleJourneys(options)
    const result = session.results[0]!
    expect(result.manifest.mode).toBe('capture')
    for (const step of result.manifest.steps) {
      expect(step.shot).toBeDefined()
      expect(existsSync(join(result.attemptDirectory, step.shot as string))).toBe(true)
      expect(step.shotSha256).toMatch(/^sha256:/)
    }
    expect(result.manifest.video?.file).toBe('video.mp4')
    expect(existsSync(join(result.attemptDirectory, 'video.mp4'))).toBe(true)
    expect(
      verifyRun(options.catalog, result.manifest, result.attemptDirectory, {
        currentDigest: DIGEST,
      }),
    ).toEqual([])

    const paths = runPaths({
      outRoot,
      environment: 'fixture',
      surface: 'ios',
      journeyId: 'gate-to-gate',
      profileName: 'phone',
      mode: 'capture',
      runId: 'unused',
    })
    promoteRun(options.catalog, result.manifest, result.attemptDirectory, {
      currentDigest: DIGEST,
      runId: result.attemptDirectory.split('/').pop() as string,
      latestPath: paths.latestPath,
    })

    // The parity claim, executable: an iOS run reaches the same walkthrough the
    // web adapter's runs reach, through the same promotion gate.
    const { written, missing } = buildWalkthrough(options.catalog, {
      outRoot,
      // The web half of a cross-surface story lives under its deployment's
      // name; the handset half lives under the fixture world it actually ran
      // against. One page, two environments.
      environment: 'demo',
      environments: { ios: 'fixture' },
      profileName: 'unused-web-profile',
      profileNames: { ios: 'phone' },
      currentDigest: DIGEST,
      destination: join(outRoot, 'walkthrough'),
    })
    expect(missing).toEqual([])
    const html = readFileSync(written, 'utf8')
    expect(html).toContain('One load, gate to gate')
    expect(html).toContain('Come back to the yard')
    expect(html).toContain('video.mp4')
    // A declared compromise travels with the evidence it changed.
    expect(html).toContain('no checklist card appears in this recording')
  })

  it('normalises the simulator recording and keeps the raw take as evidence', async () => {
    const { options, device } = harness('capture')
    const published = { bytes: '' }
    const session = await runAppleJourneys({
      ...options,
      normaliseVideo: (input, output) => {
        writeFileSync(output, `normalised-from:${input}`)
        published.bytes = `normalised-from:${input}`
        return true
      },
    })
    const result = session.results[0]!
    const rawPath = join(result.attemptDirectory, 'video.raw.mp4')
    const artefactPath = join(result.attemptDirectory, 'video.mp4')
    expect(device.recordings).toEqual([rawPath])
    expect(existsSync(rawPath)).toBe(true)
    expect(readFileSync(rawPath, 'utf8')).toMatch(/^mp4:/)
    expect(readFileSync(artefactPath, 'utf8')).toBe(published.bytes)
    expect(result.manifest.video?.file).toBe('video.mp4')
    expect(result.manifest.video?.sha256).toBe(sha256File(artefactPath))
    expect(result.manifest.video?.sha256).not.toBe(sha256File(rawPath))
  })

  it('performs the identical gestures and assertions in both modes', async () => {
    const testRun = harness('test')
    await runAppleJourneys(testRun.options)
    const captureRun = harness('capture')
    await runAppleJourneys(captureRun.options)
    const gestures = (log: string[]): string[] =>
      log.filter((entry) => entry.startsWith('tap:') || entry.startsWith('swipe:'))
    expect(gestures(captureRun.device.log)).toEqual(gestures(testRun.device.log))
    // Only pacing and artefacts differ: capture rolls a camera and takes stills.
    expect(testRun.device.screenshots).toEqual([])
    expect(captureRun.device.screenshots).toHaveLength(4)
  })

  it('fails the beat whose control popped further than declared, and stops there', async () => {
    // The 2026-08-24 near-miss, reproduced: '‹ Yard' goes to the yard ROOT, so
    // the tail beats would silently each do the previous beat's job.
    const device = screens({
      ticket: { tree: TICKET, on: { 'tap:45,80': 'yard' } },
    })
    const { options } = harness('capture', device)
    const session = await runAppleJourneys(options)
    expect(session.failed).toBe(1)
    const manifest = session.results[0]!.manifest
    expect(manifest.verdict).toBe('failed')
    const failed = manifest.steps.at(-1)
    expect(failed?.id).toBe('back-to-yard')
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toContain('did not land on "the yard, with Station D ready"')
    expect(failed?.error).toContain('"Station D"')
    // Fail fast: nothing after a broken beat is evidence of anything.
    expect(manifest.steps).toHaveLength(4)
    expect(existsSync(join(session.results[0]!.attemptDirectory, 'failure-tree.txt'))).toBe(true)
    expect(existsSync(join(session.results[0]!.attemptDirectory, 'failure.png'))).toBe(true)
    // And a failed run can never be promoted, however complete its record is.
    expect(() =>
      promoteRun(options.catalog, manifest, session.results[0]!.attemptDirectory, {
        currentDigest: DIGEST,
        runId: 'x',
        latestPath: join(session.results[0]!.attemptDirectory, 'latest'),
      }),
    ).toThrow(/only a passed run can be promoted/)
  })

  it('fails a landing that satisfies its requirements but shows what it forbids', async () => {
    const device = screens({
      ticket: { tree: TICKET, on: { 'tap:45,80': 'overlay' } },
      overlay: { tree: `${YARD_AFTER} | Ticket #1893 still open` },
    })
    const { options } = harness('test', device)
    const session = await runAppleJourneys(options)
    expect(session.failed).toBe(1)
    expect(session.results[0]!.manifest.steps.at(-1)?.error).toContain(
      '"Ticket #1893" still on screen, which this beat forbids',
    )
  })

  it('fails a press that did nothing at all', async () => {
    const device = screens({ sheet: { tree: SHEET } })
    const { options } = harness('test', device)
    const session = await runAppleJourneys(options)
    expect(session.results[0]!.manifest.steps.at(-1)?.id).toBe('mark-arrived')
    expect(session.results[0]!.manifest.steps.at(-1)?.error).toContain('nothing reading')
  })

  it('fails a beat whose landing was already true and whose gesture moved nothing', async () => {
    // The hole the first live run found: a scroll beat's text reads the same
    // before and after, so the landing passed instantly and the NEXT beat
    // pressed a coordinate the scroll had not reached yet. Nothing was red.
    const standStill = {
      ...journey(),
      steps: [
        {
          id: 'scroll-the-board',
          say: 'Scroll down to the stations',
          press: { kind: 'swipe' as const, from: { x: 201, y: 700 }, to: { x: 201, y: 200 } },
          lands: { screen: 'the stations band', requires: ['WCF-TT-21'] as [string] },
        },
      ],
    }
    const { options } = harness('test', screens(), {
      catalog: { ...fixtureCatalog(), journeys: [standStill] },
    })
    const session = await runAppleJourneys(options)
    expect(session.failed).toBe(1)
    expect(session.results[0]!.manifest.steps[0]?.error).toContain('the screen never moved')
  })

  it('fails a beat that reads a screen still in motion', async () => {
    // A decelerating scroll reads "right" long before it stops, and the next
    // beat's coordinate is pressed against wherever it ends up.
    const { options, device } = harness('test')
    let ticks = 0
    const honest = device.injector.describe.bind(device.injector)
    Object.assign(device.injector, {
      // Steady long enough for the launch to confirm its start landing, then
      // never the same twice — a screen that never stops.
      describe: () => (ticks++ < 3 ? honest() : `${honest()} | still-animating-${String(ticks)}`),
    })
    const session = await runAppleJourneys(options)
    expect(session.failed).toBe(1)
    expect(session.results[0]!.manifest.steps[0]?.error).toContain('still moving')
  })

  it('lets a beat declare that standing still is the expected outcome', async () => {
    const standStill = {
      ...journey(),
      steps: [
        {
          id: 'scroll-the-board',
          say: 'Scroll down to the stations',
          press: { kind: 'swipe' as const, from: { x: 201, y: 700 }, to: { x: 201, y: 200 } },
          lands: {
            screen: 'the stations band',
            requires: ['WCF-TT-21'] as [string],
            unchanged: true,
          },
        },
      ],
    }
    const { options } = harness('test', screens(), {
      catalog: { ...fixtureCatalog(), journeys: [standStill] },
    })
    const session = await runAppleJourneys(options)
    expect(session.failed).toBe(0)
  })

  it('fails when the launched world is not the one the journey declares', async () => {
    const device = screens()
    device.screens.yard = { tree: 'PACC TRAC yard | nothing due today', on: {} }
    const { options } = harness('test', device)
    const session = await runAppleJourneys(options)
    const manifest = session.results[0]!.manifest
    expect(manifest.scenario.confirmed).toBe(false)
    expect(manifest.scenario.preparedBy).toBe('fresh-launch:start-landing')
    expect(manifest.verdict).toBe('failed')
    expect(manifest.steps).toEqual([])
  })

  it('records a named confirmation when the world can give one', async () => {
    const { options } = harness('test', screens(), {
      world: { ...world, confirm: () => 'walkthrough' },
    })
    const session = await runAppleJourneys(options)
    expect(session.results[0]!.manifest.scenario.preparedBy).toBe('fresh-launch:named')
    expect(session.results[0]!.manifest.scenario.confirmed).toBe(true)
  })

  it('fails the run when the app was replaced under the journey', async () => {
    const { options, device } = harness('test')
    const original = device.control.pid
    let calls = 0
    Object.assign(device.control, {
      // The first read is the launch settle; every later one sees a different
      // process, which is an app that was replaced under the journey.
      pid(bundleId: string) {
        calls += 1
        return calls > 1 ? 9999 : original.call(device.control, bundleId)
      },
    })
    const session = await runAppleJourneys(options)
    const manifest = session.results[0]!.manifest
    expect(manifest.scenario.generation).not.toBe(manifest.scenario.generationAfter)
    expect(manifest.verdict).toBe('failed')
    expect(
      verifyRun(options.catalog, manifest, session.results[0]!.attemptDirectory, {
        currentDigest: DIGEST,
      }),
    ).toEqual([expect.stringContaining('world generation changed mid-run')])
  })

  it('throws at the end of a session with failures unless told not to', async () => {
    const device = screens({ sheet: { tree: SHEET } })
    const { options } = harness('test', device, { throwOnFailure: undefined })
    await expect(runAppleJourneys(options)).rejects.toThrow(/1 Apple journey\(s\) failed/)
  })

  it('refuses an unpinned, missing, or non-bundle app path', async () => {
    const { options } = harness('test')
    await expect(runAppleJourneys({ ...options, appPath: '' })).rejects.toThrow(
      /appPath is required/,
    )
    await expect(runAppleJourneys({ ...options, appPath: '/nope/Missing.app' })).rejects.toThrow(
      /does not exist/,
    )
    const notABundle = mkdtempSync(join(tmpdir(), 'njr-notapp-'))
    await expect(runAppleJourneys({ ...options, appPath: notABundle })).rejects.toThrow(
      /not a \.app bundle/,
    )
  })

  it('refuses a catalog journey bound to an XCTest method', async () => {
    const { options } = harness('test')
    const mixed = {
      ...options.catalog,
      journeys: [
        {
          ...journey(),
          id: 'bound-journey',
          drive: 'xctest' as const,
          steps: [{ id: 'only', say: 'One' }],
          binding: { xcTarget: 'T', xcClass: 'C', xcMethod: 'm' },
        },
      ],
    } as Catalog
    await expect(runAppleJourneys({ ...options, catalog: mixed })).rejects.toThrow(
      /does not run xcodebuild/,
    )
  })

  it('prints a reviewable plan of beats and landings', () => {
    const plan = appleJourneyPlan(journey(), 'walkthrough')
    expect(plan).toContain('tap 201,258')
    expect(plan).toContain('→ the sheet')
    expect(plan).toContain('compromise: procedures are switched off')
  })
})

describe('the injector, resolved', () => {
  it('refuses to run without one rather than filming a screen nobody pressed', () => {
    expect(() => resolveInjector({ udid: 'X', env: {}, commandExists: () => false })).toThrow(
      /no gesture injector[\s\S]*JOURNEYS_TAP_CMD/,
    )
  })

  it('takes explicit templates, and fills every placeholder', () => {
    const calls: string[] = []
    const injector = resolveInjector({
      udid: 'UDID-1',
      env: {},
      commandExists: () => false,
      templates: {
        tap: 'echo tap {udid} {x} {y}',
        swipe: 'echo swipe {udid} {x1} {y1} {x2} {y2} {duration}',
        describe: 'echo tree-of {udid}',
      },
    })
    calls.push(injector.describe().trim())
    expect(calls[0]).toBe('tree-of UDID-1')
    expect(() => injector.type('hello')).toThrow(/JOURNEYS_TEXT_CMD/)
  })

  it('adopts the documented idb templates only when idb is actually present', () => {
    const injector = resolveInjector({ udid: 'U', env: {}, commandExists: () => true })
    expect(injector.name).toBe('idb')
  })
})

describe('the driven declaration', () => {
  const base = fixtureCatalog()

  it('rejects a beat with no landing to verify', () => {
    const broken = {
      ...base,
      journeys: [
        {
          ...journey(),
          steps: [{ id: 'blind', say: 'Press something', press: { kind: 'tap', x: 10, y: 10 } }],
        },
      ],
    } as unknown as Catalog
    expect(() => defineCatalog(broken)).toThrow(/declares no landing/)
  })

  it('rejects a gesture aimed off the declared handset', () => {
    const broken = {
      ...base,
      journeys: [
        {
          ...journey(),
          steps: [
            {
              id: 'off-screen',
              say: 'Press the void',
              press: { kind: 'tap', x: 900, y: 10 },
              lands: { screen: 'nowhere', requires: ['nothing'] },
            },
          ],
        },
      ],
    } as unknown as Catalog
    expect(() => defineCatalog(broken)).toThrow(/is off every declared handset/)
  })

  it('rejects a landing that requires and forbids the same thing', () => {
    const broken = {
      ...base,
      journeys: [
        {
          ...journey(),
          steps: [
            {
              id: 'impossible',
              say: 'Press',
              press: { kind: 'tap', x: 10, y: 10 },
              lands: { screen: 'both', requires: ['A'], forbids: ['A'] },
            },
          ],
        },
      ],
    } as unknown as Catalog
    expect(() => defineCatalog(broken)).toThrow(/both requires and forbids/)
  })

  it('rejects a compromise that does not say what it costs', () => {
    const broken = {
      ...base,
      journeys: [{ ...journey(), compromises: [{ what: 'a flag', why: 'because', cost: '' }] }],
    } as unknown as Catalog
    expect(() => defineCatalog(broken)).toThrow(/what, why AND what it costs/)
  })
})

/** The fixture catalog, with the journey's first beat replaced. */
function catalogWithFirstStep(step: Partial<AppleDrivenStep>): Catalog {
  const walk = journey()
  walk.steps[0] = { ...(walk.steps[0] as AppleDrivenStep), ...step }
  return defineCatalog({ ...fixtureCatalog(), journeys: [walk] })
}

const OPEN_ROW = { id: 'yard.open.WCF-TT-21', x: 201, y: 258 }
const MENU = { id: 'yard.menu', x: 20, y: 60 }

describe('a press by name, a key, and a world that is made (narduk-libs#75)', () => {
  it('presses a control by its accessibility identifier, located on the screen it is pressed on', async () => {
    const device = screens()
    device.screens.yard = { ...device.screens.yard!, elements: [MENU, OPEN_ROW] }
    const { options, device: fake } = harness('test', device, {
      catalog: catalogWithFirstStep({ press: { kind: 'element', id: 'yard.open.WCF-TT-21' } }),
    })
    const session = await runAppleJourneys(options)
    expect(session.results[0]!.manifest.verdict).toBe('passed')
    const located = fake.log.indexOf('elements')
    expect(located).toBeGreaterThan(-1)
    expect(fake.log[located + 1]).toBe('tap:201,258')
  })

  it('fails a press whose identifier is not on screen, and names what was', async () => {
    const device = screens()
    device.screens.yard = { ...device.screens.yard!, elements: [OPEN_ROW, MENU] }
    const { options } = harness('test', device, {
      catalog: catalogWithFirstStep({ press: { kind: 'element', id: 'yard.open.GONE' } }),
    })
    const manifest = (await runAppleJourneys(options)).results[0]!.manifest
    expect(manifest.verdict).toBe('failed')
    expect(manifest.steps[0]!.error).toBe(
      'no control "yard.open.GONE" on screen; identifiers on screen: "yard.menu", "yard.open.WCF-TT-21"',
    )
  })

  it('refuses an identifier that more than one control carries', async () => {
    const device = screens()
    device.screens.yard = { ...device.screens.yard!, elements: [OPEN_ROW, { ...OPEN_ROW, y: 400 }] }
    const { options } = harness('test', device, {
      catalog: catalogWithFirstStep({ press: { kind: 'element', id: OPEN_ROW.id } }),
    })
    const manifest = (await runAppleJourneys(options)).results[0]!.manifest
    expect(manifest.steps[0]!.error).toMatch(/2 controls carry "yard.open.WCF-TT-21"/)
  })

  it('refuses a press by identifier when the injector cannot locate controls', async () => {
    const { options, device } = harness('test', screens(), {
      catalog: catalogWithFirstStep({ press: { kind: 'element', id: OPEN_ROW.id } }),
    })
    const { elements: _dropped, ...blind } = device.injector
    const manifest = (await runAppleJourneys({ ...options, injector: blind })).results[0]!.manifest
    expect(manifest.steps[0]!.error).toMatch(/cannot locate a control by identifier/)
  })

  it('presses a key as many times as the beat declares', async () => {
    const device = screens()
    device.screens.yard = { ...device.screens.yard!, on: { 'key:tab': 'sheet' } }
    const { options, device: fake } = harness('test', device, {
      catalog: catalogWithFirstStep({ press: { kind: 'key', key: 'tab', repeat: 3 } }),
    })
    const session = await runAppleJourneys(options)
    expect(session.results[0]!.manifest.verdict).toBe('passed')
    expect(fake.log.filter((entry) => entry === 'key:tab')).toHaveLength(3)
  })

  it('refuses a key press when the injector cannot press keys', async () => {
    const { options, device } = harness('test', screens(), {
      catalog: catalogWithFirstStep({ press: { kind: 'key', key: 'return' } }),
    })
    const { key: _dropped, ...keyless } = device.injector
    const manifest = (await runAppleJourneys({ ...options, injector: keyless })).results[0]!
      .manifest
    expect(manifest.steps[0]!.error).toMatch(/cannot press keys/)
  })

  it('fails a gesture kind nobody implemented instead of performing nothing', async () => {
    const { options } = harness('test')
    // Past the declaration gate, which refuses it: the adapter must refuse too.
    const walk = options.catalog.journeys[0] as DrivenAppleJourney
    walk.steps[0] = {
      ...walk.steps[0]!,
      press: { kind: 'pinch' } as unknown as AppleDrivenStep['press'],
    }
    const manifest = (await runAppleJourneys(options)).results[0]!.manifest
    expect(manifest.steps[0]!.error).toBe('unknown gesture kind "pinch"')
  })

  it('makes the world before the app launches into it', async () => {
    const { options, device } = harness('test', screens(), {
      world: {
        ...world,
        prepare: ({ scenarioId }) => {
          device.log.push(`prepare:${scenarioId}`)
        },
      },
    })
    const session = await runAppleJourneys(options)
    expect(session.results[0]!.manifest.verdict).toBe('passed')
    const prepared = device.log.indexOf('prepare:walkthrough')
    expect(prepared).toBeGreaterThan(-1)
    expect(prepared).toBeLessThan(device.log.findIndex((entry) => entry.startsWith('launch:')))
  })

  it('stops the session, naming the journey and scenario, when the world cannot be made', async () => {
    const { options } = harness('test', screens(), {
      world: {
        ...world,
        prepare: () => {
          throw new Error('seed refused')
        },
      },
    })
    await expect(runAppleJourneys(options)).rejects.toThrow(
      'gate-to-gate: world.prepare("walkthrough") failed: seed refused',
    )
  })

  it("fails the run when the world's own generation moves under the journey", async () => {
    const seeds = ['seed-1', 'seed-2']
    const { options } = harness('test', screens(), {
      world: { ...world, generation: () => seeds.shift() ?? 'seed-3' },
    })
    const session = await runAppleJourneys(options)
    const manifest = session.results[0]!.manifest
    expect(manifest.scenario.generation).toBe('pid:4242 world:seed-1')
    expect(manifest.scenario.generationAfter).toBe('pid:4242 world:seed-2')
    expect(manifest.verdict).toBe('failed')
    expect(
      verifyRun(options.catalog, manifest, session.results[0]!.attemptDirectory, {
        currentDigest: DIGEST,
      }),
    ).toEqual([expect.stringContaining('world generation changed mid-run')])
  })

  it('checks the start landing even when the world confirms itself by name', async () => {
    const device = screens()
    device.screens.yard = { tree: 'PACC TRAC yard | nothing due today', on: {} }
    const { options } = harness('test', device, {
      world: { ...world, confirm: () => 'walkthrough' },
    })
    const manifest = (await runAppleJourneys(options)).results[0]!.manifest
    expect(manifest.scenario.preparedBy).toBe('fresh-launch:named')
    expect(manifest.scenario.confirmed).toBe(false)
    expect(manifest.verdict).toBe('failed')
  })

  it('prints element and key presses in the plan', () => {
    const walk = journey()
    walk.steps[0] = { ...walk.steps[0]!, press: { kind: 'element', id: OPEN_ROW.id } }
    walk.steps[1] = { ...walk.steps[1]!, press: { kind: 'key', key: 'backspace', repeat: 3 } }
    const plan = appleJourneyPlan(walk, 'walkthrough')
    expect(plan).toContain('press #yard.open.WCF-TT-21')
    expect(plan).toContain('key backspace ×3')
  })

  it('reads identified controls out of idb describe-all output', () => {
    const idb = JSON.stringify([
      { AXUniqueId: null, frame: { x: 0, y: 0, width: 402, height: 874 } },
      {
        AXUniqueId: 'yard.menu',
        frame: { x: 0, y: 40, width: 40, height: 40 },
        children: [
          { AXUniqueId: 'yard.menu.badge', frame: { x: 30, y: 40, width: 10, height: 10 } },
        ],
      },
    ])
    expect(parseIdbElements(idb)).toEqual([
      { id: 'yard.menu', x: 20, y: 60 },
      { id: 'yard.menu.badge', x: 35, y: 45 },
    ])
    const perLine = ['{"AXUniqueId":"a","frame":{"x":0,"y":0,"width":2,"height":2}}', ''].join('\n')
    expect(parseIdbElements(perLine)).toEqual([{ id: 'a', x: 1, y: 1 }])
    expect(() => parseIdbElements('Button "Mark arrived"')).toThrow(/idb-shaped JSON/)
  })

  it('locates controls and presses keys through command templates', () => {
    const injector = resolveInjector({
      udid: 'UDID-1',
      env: {},
      commandExists: () => false,
      templates: {
        tap: 'echo tap {udid} {x} {y}',
        swipe: 'echo swipe {udid} {x1} {y1} {x2} {y2} {duration}',
        describe: 'echo [{"AXUniqueId":"row","frame":{"x":0,"y":10,"width":100,"height":20}}]',
        key: 'echo key {udid} {hid} {key}',
      },
    })
    expect(injector.elements?.()).toEqual([{ id: 'row', x: 50, y: 20 }])
    expect(() => injector.key?.('return')).not.toThrow()
    const keyless = resolveInjector({
      udid: 'UDID-1',
      env: {},
      commandExists: () => false,
      templates: { tap: 'echo', swipe: 'echo', describe: 'echo' },
    })
    expect(() => keyless.key?.('tab')).toThrow(/JOURNEYS_KEY_CMD/)
  })

  it('rejects an element with no identifier, an unknown key, a bad repeat and an unknown kind', () => {
    const presses = [
      { press: { kind: 'element', id: '' }, problem: /presses an element with no identifier/ },
      { press: { kind: 'key', key: 'hyper' }, problem: /key "hyper" is not one of return, tab/ },
      {
        press: { kind: 'key', key: 'tab', repeat: 0 },
        problem: /key repeat must be a positive integer/,
      },
      { press: { kind: 'pinch' }, problem: /unknown gesture kind "pinch"/ },
    ]
    for (const { press, problem } of presses) {
      const walk = journey()
      walk.steps[0] = { ...walk.steps[0]!, press } as unknown as AppleDrivenStep
      expect(() => defineCatalog({ ...fixtureCatalog(), journeys: [walk] })).toThrow(problem)
    }
  })
})
