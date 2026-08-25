/**
 * The Apple orchestrator (§6.3), built to the six requirements narduk-libs#70
 * wrote from the first real consumer run:
 *
 *   1. the world is selected by LAUNCH ARGUMENTS — the Apple analogue of
 *      `world.prepare`;
 *   2. gestures go through a pluggable, headless-capable INJECTOR, and their
 *      absence is a hard refusal rather than a video of a home screen;
 *   3. `simctl io recordVideo` films it, with beat-aligned dwell that MODE
 *      sets — the steps and the assertions are identical in both modes;
 *   4. the app binary is PINNED by path; nothing here ever guesses "newest in
 *      DerivedData";
 *   5. every beat VERIFIES ITS LANDING and throws when it cannot, so a
 *      mis-navigating control fails the run instead of shifting every beat
 *      after it;
 *   6. the simulator is LEASED for the run, so two lanes cannot share a device.
 *
 * It emits the same `njr-run/1` manifests as the web adapter, into the same
 * artefact layout, so `verify`, `promote` and `walkthrough` work on an iOS run
 * exactly as they do on a web one. That is the whole point: one declaration,
 * one verifier, two surfaces.
 *
 * This module is an OPTIONAL subpath (`@narduk-enterprises/journeys/apple`).
 * The core stays importable by plain Node with no simulator, no Xcode and no
 * injector installed.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { sha256File, videoSeconds } from './media.js'
import type {
  AppleDrivenStep,
  AppleGesture,
  AppleLanding,
  AppleProfile,
  Catalog,
  DrivenAppleJourney,
  Mode,
  RunManifest,
  RunStep,
} from './types.js'
import { RUN_SCHEMA } from './types.js'
import { expectedStepIds, makeRunId, runPaths } from './verify.js'
import type { AppleInjector, SimulatorControl } from './apple-control.js'
import { acquireSimulatorLease } from './apple-lease.js'
import type { SimulatorLease } from './apple-lease.js'

export * from './apple-binding.js'
export * from './apple-control.js'
export * from './apple-lease.js'

/**
 * The repository-owned Apple world (§5). The mechanics stay in the repository;
 * the contract is that a scenario id resolves to the launch arguments that
 * produce that world, and that the world can say what revision of the app it
 * is.
 */
export interface AppleWorldHooks {
  /** Launch arguments for this scenario — the fixture-world idiom, declared (requirement 1). */
  launchArgs(scenarioId: string): readonly string[] | Promise<readonly string[]>
  /** What the app itself reports as its revision. Recorded in run.json. */
  appRevision(): string | Promise<string>
  /**
   * OPTIONAL confirmation BY NAME, the web loader's guarantee: an app that can
   * report which fixture world it loaded returns that id here and the runner
   * asserts it matches what it asked for.
   *
   * Its absence is recorded, not papered over. Without it the run's only
   * confirmation is that the launched world renders the journey's declared
   * `start` landing — real, weaker than a name, and written into
   * `scenario.preparedBy` as `fresh-launch:start-landing` so a reader of the
   * manifest can tell the two apart.
   */
  confirm?(context: {
    control: SimulatorControl
    injector: AppleInjector
    scenarioId: string
  }): string | Promise<string>
}

export interface AppleRunOptions {
  catalog: Catalog
  world: AppleWorldHooks
  control: SimulatorControl
  injector: AppleInjector
  /**
   * The exact `.app` to install (requirement 4). Required, and there is no
   * search: "newest in DerivedData" silently follows whoever compiled last,
   * and on 2026-08-24 it put a concurrent lane's build under a take whose
   * coordinates had been walked against a different one.
   */
  appPath: string
  bundleId: string
  outRoot: string
  environment: string
  profileName: string
  declarationDigest: string
  commit?: string
  /** Defaults to process.env.JOURNEYS_MODE, then 'test'. */
  mode?: Mode
  /** Run only these journey ids. */
  only?: string[]
  /** Capture-mode dwell for a step that declares none. */
  defaultDwellMs?: number
  /** How long a landing may take to appear. Identical in both modes. */
  settleTimeoutMs?: number
  /** Lease knobs (requirement 6). */
  lease?: { dir?: string; holder?: string; ttlMs?: number; isAlive?: (pid: number) => boolean }
  /** Throw at the end when any journey failed. Default true — fail closed. */
  throwOnFailure?: boolean
  /** Seams for hermetic tests. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface AppleJourneyResult {
  journey: string
  scenario: string
  attemptDirectory: string
  manifest: RunManifest
}

export interface AppleSessionResult {
  results: AppleJourneyResult[]
  failed: number
  /** The pinned binary, hashed, exactly as the manifests recorded it. */
  app: { path: string; sha256: string }
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Hash the pinned bundle so every manifest says WHICH build it filmed
 * (requirement 4). Regular files only, in sorted relative-path order; symlinks
 * inside embedded frameworks are structure, not content, and are skipped.
 */
export function hashAppBundle(appPath: string): string {
  const hash = createHash('sha256')
  const separator = Buffer.from([0])
  const walk = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    for (const entry of entries) {
      const full = join(directory, entry.name)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(full, relative)
      } else if (entry.isFile()) {
        hash.update(relative)
        hash.update(separator)
        hash.update(readFileSync(full))
        hash.update(separator)
      }
    }
  }
  walk(appPath, '')
  return `sha256:${hash.digest('hex')}`
}

function assertPinnedApp(appPath: string): void {
  if (!appPath) {
    throw new Error('appPath is required: an Apple capture pins the binary it films, always')
  }
  if (!existsSync(appPath)) throw new Error(`appPath does not exist: ${appPath}`)
  if (!statSync(appPath).isDirectory() || !appPath.endsWith('.app')) {
    throw new Error(`appPath is not a .app bundle: ${appPath}`)
  }
  if (!existsSync(join(appPath, 'Info.plist'))) {
    throw new Error(`appPath has no Info.plist, so it is not an app bundle: ${appPath}`)
  }
}

interface LandingVerdict {
  landed: boolean
  tree: string
  message?: string
}

/**
 * A screen's identity, independent of how the injector happened to serialise
 * it. `idb ui describe-all` emits its JSON object keys in a different order on
 * every call, so raw text cannot answer "did the screen change?" — but the
 * SORTED TOKEN MULTISET can, and it does so without this package knowing one
 * thing about idb's schema. A scroll moves frame numbers and therefore changes
 * it; a re-serialisation of the same screen does not.
 */
function fingerprint(tree: string): string {
  return (tree.match(/[\w.-]+/g) ?? []).sort().join(' ')
}

function readLanding(tree: string, landing: AppleLanding, before?: string): LandingVerdict {
  const haystack = tree.toLowerCase()
  const missing = landing.requires.filter((needle) => !haystack.includes(needle.toLowerCase()))
  const forbidden = (landing.forbids ?? []).filter((needle) =>
    haystack.includes(needle.toLowerCase()),
  )
  // A landing that was ALREADY TRUE before the gesture proves nothing about the
  // gesture. Found by the first live run: a scroll beat whose text is readable
  // both before and after passed instantly, and the next beat then pressed a
  // coordinate the scroll had not reached yet. Requiring the screen to have
  // MOVED is what turns that from a plausible video into a red run.
  const stuck = before !== undefined && fingerprint(tree) === before
  if (missing.length === 0 && forbidden.length === 0 && !stuck) return { landed: true, tree }
  const parts: string[] = []
  if (missing.length > 0) parts.push(`nothing reading ${missing.map(quote).join(', ')}`)
  if (forbidden.length > 0) {
    parts.push(`${forbidden.map(quote).join(', ')} still on screen, which this beat forbids`)
  }
  if (stuck && parts.length === 0) {
    parts.push('the screen never moved, so the gesture landed nowhere')
  } else if (stuck) {
    parts.push('and the screen never moved')
  }
  return {
    landed: false,
    tree,
    message: `did not land on "${landing.screen}": ${parts.join('; ')}`,
  }
}

function quote(value: string): string {
  return `"${value}"`
}

/**
 * Poll the accessibility hierarchy until the landing holds AND THE SCREEN HAS
 * STOPPED MOVING, or give up loudly.
 *
 * "Stopped moving" is two consecutive reads that agree, which is the honest
 * definition available from outside the app and the one that matters: a beat
 * that reads a decelerating scroll has verified a position the next beat's
 * coordinate will not be pressed against. This is pacing for CORRECTNESS and is
 * identical in both modes — narrative dwell is the separate, capture-only thing
 * that happens after a beat has passed.
 */
async function awaitLanding(
  injector: AppleInjector,
  landing: AppleLanding,
  options: {
    timeoutMs: number
    sleep: (ms: number) => Promise<void>
    now: () => number
    /** The fingerprint before the gesture; the landing must differ from it. */
    before?: string
  },
): Promise<LandingVerdict> {
  const deadline = options.now() + options.timeoutMs
  let previous: string | undefined
  let verdict: LandingVerdict
  for (;;) {
    const tree = injector.describe()
    const current = fingerprint(tree)
    verdict = readLanding(tree, landing, options.before)
    const settled = current === previous
    if (verdict.landed && settled) return verdict
    if (options.now() >= deadline) break
    previous = current
    await options.sleep(400)
  }
  if (verdict.landed) {
    return {
      ...verdict,
      landed: false,
      message:
        `landed on "${landing.screen}" but the screen was still moving when the beat's ` +
        'time ran out, so the next beat would press a coordinate that has not settled',
    }
  }
  return verdict
}

function performGesture(injector: AppleInjector, gesture: AppleGesture): void {
  switch (gesture.kind) {
    case 'tap':
      injector.tap(gesture.x, gesture.y)
      return
    case 'swipe':
      injector.swipe(gesture.from, gesture.to, gesture.duration)
      return
    case 'type':
      injector.type(gesture.text)
      return
    case 'wait':
      return
  }
}

function drivenJourneys(catalog: Catalog, only?: string[]): DrivenAppleJourney[] {
  const wanted = catalog.journeys.filter((journey) => !only || only.includes(journey.id))
  for (const journey of wanted) {
    if (journey.surface === 'web') continue
    if (journey.drive !== 'driven') {
      throw new Error(
        `journey "${journey.id}" is bound to an XCTest method; this adapter drives the app ` +
          'directly and does not run xcodebuild. Run it through the test suite, or declare it ' +
          "`drive: 'driven'`.",
      )
    }
  }
  return wanted.filter(
    (journey): journey is DrivenAppleJourney =>
      journey.surface !== 'web' && journey.drive === 'driven',
  )
}

/**
 * One session: one leased simulator, one pinned binary, journeys run SERIALLY
 * with a fresh launch each (§5 — a shared world that leaks between journeys is
 * the same wrong-but-green shape one size down). Nothing retries: a capture
 * exists to be looked at, and a flaky pass hidden behind a retry is a worse
 * demo than a red run.
 */
export async function runAppleJourneys(options: AppleRunOptions): Promise<AppleSessionResult> {
  const mode: Mode = options.mode ?? (process.env.JOURNEYS_MODE === 'capture' ? 'capture' : 'test')
  const commit = options.commit ?? process.env.JOURNEYS_COMMIT ?? 'uncommitted'
  const sleep = options.sleep ?? realSleep
  const now = options.now ?? Date.now
  const settleTimeoutMs = options.settleTimeoutMs ?? 15_000
  const profile = options.catalog.profiles[options.profileName]
  if (!profile || profile.kind !== 'apple') {
    throw new Error(`profile "${options.profileName}" is not a declared apple profile`)
  }

  assertPinnedApp(options.appPath)
  const journeys = drivenJourneys(options.catalog, options.only)
  if (journeys.length === 0) throw new Error('no driven Apple journeys selected')

  const appSha = hashAppBundle(options.appPath)
  const lease: SimulatorLease = acquireSimulatorLease({
    udid: options.control.udid,
    holder: options.lease?.holder ?? `journeys/${options.environment}/${String(process.pid)}`,
    leaseDir: options.lease?.dir,
    ttlMs: options.lease?.ttlMs,
    isAlive: options.lease?.isAlive,
    now,
  })

  const results: AppleJourneyResult[] = []
  try {
    options.control.boot()
    options.control.install(options.appPath)
    for (const journey of journeys) {
      // Capture films the FIRST declared scenario (§2.2); test walks each.
      const scenarioIds = mode === 'capture' ? [journey.scenarios[0]] : journey.scenarios
      for (const scenarioId of scenarioIds) {
        lease.renew()
        results.push(
          await runOneJourney({
            journey,
            scenarioId,
            mode,
            commit,
            profile,
            appSha,
            settleTimeoutMs,
            sleep,
            now,
            options,
          }),
        )
      }
    }
  } finally {
    lease.release()
  }

  const failed = results.filter((result) => result.manifest.verdict !== 'passed').length
  if (failed > 0 && options.throwOnFailure !== false) {
    const names = results
      .filter((result) => result.manifest.verdict !== 'passed')
      .map((result) => result.journey)
    throw new Error(`${String(failed)} Apple journey(s) failed: ${names.join(', ')}`)
  }
  return { results, failed, app: { path: options.appPath, sha256: appSha } }
}

interface OneJourneyArgs {
  journey: DrivenAppleJourney
  scenarioId: string
  mode: Mode
  commit: string
  profile: AppleProfile
  appSha: string
  settleTimeoutMs: number
  sleep: (ms: number) => Promise<void>
  now: () => number
  options: AppleRunOptions
}

async function runOneJourney(args: OneJourneyArgs): Promise<AppleJourneyResult> {
  const { journey, scenarioId, mode, profile, options, sleep, now } = args
  const { control, injector } = options
  const startedAt = new Date(now())
  const attemptId = makeRunId(args.commit, startedAt)
  const paths = runPaths({
    outRoot: options.outRoot,
    environment: options.environment,
    surface: journey.surface,
    journeyId: journey.id,
    profileName: options.profileName,
    mode,
    runId: attemptId,
  })
  mkdirSync(join(paths.attemptDirectory, 'steps'), { recursive: true })

  // 1 · the world, by launch argument (requirement 1).
  const scenarioArgs = await options.world.launchArgs(scenarioId)
  const launchArgs = [...scenarioArgs, ...journey.launchArgs]
  control.terminate(options.bundleId)
  control.launch(options.bundleId, launchArgs)

  // The generation token: the pid this journey ran against. Re-read at the end,
  // a changed one means the app was replaced under the journey and everything
  // after that point is evidence of nothing (§4.2, §5).
  const deadline = now() + args.settleTimeoutMs
  let pid = control.pid(options.bundleId)
  while (pid === null && now() < deadline) {
    await sleep(400)
    pid = control.pid(options.bundleId)
  }
  if (pid === null) {
    throw new Error(
      `${journey.id}: the app never came to the foreground within ` +
        `${String(args.settleTimeoutMs)}ms of launch (${launchArgs.join(' ')})`,
    )
  }
  const generation = `pid:${String(pid)}`

  // 2 · confirm the world, by name where the app can, by its declared start
  //     landing otherwise — and say in the manifest which one this was.
  let confirmed: boolean
  let preparedBy: string
  let startVerdict: LandingVerdict | null = null
  if (options.world.confirm) {
    const reported = await options.world.confirm({ control, injector, scenarioId })
    confirmed = reported === scenarioId
    preparedBy = 'fresh-launch:named'
  } else {
    startVerdict = await awaitLanding(injector, journey.start, {
      timeoutMs: args.settleTimeoutMs,
      sleep,
      now,
    })
    confirmed = startVerdict.landed
    preparedBy = 'fresh-launch:start-landing'
  }
  if (!confirmed && startVerdict) {
    writeFileSync(join(paths.attemptDirectory, 'failure-tree.txt'), startVerdict.tree)
    control.screenshot(join(paths.attemptDirectory, 'failure.png'))
  }

  // 3 · roll the camera (capture only). Pacing is the only thing mode changes.
  const recording =
    mode === 'capture' ? control.record(join(paths.attemptDirectory, 'video.mp4')) : null
  if (recording) await sleep(1_500)
  const clockStart = now()

  const included = new Set(expectedStepIds(journey, scenarioId))
  const steps: RunStep[] = []
  let failure: string | null = confirmed
    ? null
    : `the launched world is not the one "${scenarioId}" declares: ${
        startVerdict?.message ?? 'the world did not confirm the scenario'
      }`
  let ordinal = 0

  if (!failure) {
    for (const step of journey.steps) {
      if (!included.has(step.id)) continue
      ordinal += 1
      const record: RunStep = {
        id: step.id,
        ordinal,
        status: 'passed',
        say: step.say,
        startedMs: now() - clockStart,
        endedMs: now() - clockStart,
      }
      steps.push(record)
      // What the screen was BEFORE the gesture, so the landing can insist it
      // moved. A `wait` beat performs nothing and is exempt by construction; so
      // is a landing that declares `unchanged`.
      const before =
        step.press.kind === 'wait' || step.lands.unchanged
          ? undefined
          : fingerprint(injector.describe())
      try {
        performGesture(injector, step.press)
      } catch (error) {
        record.status = 'failed'
        record.error = error instanceof Error ? error.message : String(error)
        record.endedMs = now() - clockStart
        failure = `step "${step.id}" could not be performed: ${record.error}`
        break
      }

      // 4 · the landing, verified — identically in both modes (requirement 5).
      const verdict = await awaitLanding(injector, step.lands, {
        before,
        timeoutMs: args.settleTimeoutMs,
        sleep,
        now,
      })
      record.endedMs = now() - clockStart
      if (!verdict.landed) {
        record.status = 'failed'
        record.error = `step "${step.id}" ${verdict.message ?? 'did not land'}`
        failure = record.error
        writeFileSync(join(paths.attemptDirectory, 'failure-tree.txt'), verdict.tree)
        control.screenshot(join(paths.attemptDirectory, 'failure.png'))
        break
      }

      if (mode === 'capture') {
        const shot = `steps/${String(ordinal).padStart(2, '0')}-${step.id}.png`
        control.screenshot(join(paths.attemptDirectory, shot))
        record.shot = shot
        record.shotSha256 = sha256File(join(paths.attemptDirectory, shot))
        // 5 · beat-aligned dwell: capture only, and AFTER the assertion, so a
        //     mode can never change what passes (requirement 3).
        await sleep(step.capture?.dwell ?? options.defaultDwellMs ?? 2_500)
      }
    }
  }

  const generationAfter = `pid:${String(control.pid(options.bundleId) ?? 'gone')}`
  let video: RunManifest['video']
  if (recording) {
    await sleep(1_200)
    await recording.stop()
    const videoPath = join(paths.attemptDirectory, 'video.mp4')
    if (existsSync(videoPath)) {
      video = {
        file: 'video.mp4',
        seconds: videoSeconds(videoPath),
        sha256: sha256File(videoPath),
      }
    }
  }

  const device = control.describeDevice()
  const manifest: RunManifest = {
    schema: RUN_SCHEMA,
    journey: journey.id,
    surface: journey.surface,
    mode,
    base: `simulator://${control.udid}/${options.bundleId}`,
    commit: args.commit,
    declarationDigest: options.declarationDigest,
    appRevision: await options.world.appRevision(),
    profile: {
      name: options.profileName,
      device: profile.device,
      resolvedDevice: device.name,
      os: device.runtime,
      orientation: profile.orientation ?? 'portrait',
      udid: control.udid,
      app: { path: options.appPath, sha256: args.appSha },
      injector: injector.name,
      launchArgs,
    },
    startedAt: startedAt.toISOString(),
    scenario: {
      id: scenarioId,
      confirmed,
      generation,
      generationAfter,
      preparedBy,
    },
    verdict: failure || !confirmed || generation !== generationAfter ? 'failed' : 'passed',
    steps,
    ...(video ? { video } : {}),
  }
  writeFileSync(join(paths.attemptDirectory, 'run.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return {
    journey: journey.id,
    scenario: scenarioId,
    attemptDirectory: paths.attemptDirectory,
    manifest,
  }
}

/**
 * The beats and their landings, as text. What `--plan` was in the consumer's
 * bespoke script: the readout a person checks BEFORE a camera rolls, and the
 * one thing that makes a coordinate reviewable rather than believed.
 */
export function appleJourneyPlan(journey: DrivenAppleJourney, scenarioId: string): string {
  const included = new Set(expectedStepIds(journey, scenarioId))
  const lines = [
    `${journey.id} — ${journey.title}`,
    `  world:  ${scenarioId} + ${journey.launchArgs.join(' ') || '(no journey arguments)'}`,
    `  start:  ${journey.start.screen}`,
  ]
  for (const compromise of journey.compromises ?? []) {
    lines.push(`  compromise: ${compromise.what} — ${compromise.why} (costs: ${compromise.cost})`)
  }
  let ordinal = 0
  for (const step of journey.steps) {
    if (!included.has(step.id)) continue
    ordinal += 1
    lines.push(
      `  ${String(ordinal).padStart(2)}. ${describeGesture(step.press).padEnd(26)} → ${step.lands.screen}`,
    )
  }
  return lines.join('\n')
}

function describeGesture(gesture: AppleGesture): string {
  switch (gesture.kind) {
    case 'tap':
      return `tap ${String(gesture.x)},${String(gesture.y)}`
    case 'swipe':
      return `swipe ${String(gesture.from.x)},${String(gesture.from.y)} → ${String(gesture.to.x)},${String(gesture.to.y)}`
    case 'type':
      return `type "${gesture.text}"`
    case 'wait':
      return 'wait'
  }
}

export type { AppleDrivenStep, DrivenAppleJourney }
