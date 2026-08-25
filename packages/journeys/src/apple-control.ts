/**
 * The two boundaries the Apple adapter talks to a real machine through: the
 * simulator (`xcrun simctl`) and the gesture injector.
 *
 * Both are interfaces first and shell commands second, which is what lets the
 * orchestration be unit-tested on a Linux CI runner with no simulator, no idb
 * and no Xcode — the same split the web adapter gets for free from Playwright's
 * own test double story.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'

export interface Recording {
  /** SIGINT and wait: `recordVideo` finalises on interrupt and leaves an unplayable fragment on a hard kill. */
  stop(): Promise<void>
}

export interface SimulatorControl {
  readonly udid: string
  boot(): void
  /** Replace the installed app with this exact bundle. */
  install(appPath: string): void
  terminate(bundleId: string): void
  launch(bundleId: string, args: readonly string[]): void
  /** The running app's pid, or null. This is the run's generation token. */
  pid(bundleId: string): number | null
  screenshot(path: string): void
  record(path: string): Recording
  /** Device name and runtime, for the run manifest's profile. */
  describeDevice(): { name: string; runtime: string }
}

export interface AppleInjector {
  /** What the manifest records as the hand that drove the run. */
  readonly name: string
  tap(x: number, y: number): void
  swipe(from: { x: number; y: number }, to: { x: number; y: number }, duration?: number): void
  type(text: string): void
  /** The accessibility hierarchy, as text. The landing predicate reads this. */
  describe(): string
}

export interface InjectorTemplates {
  /** Placeholders: {udid} {x} {y} */
  tap: string
  /** Placeholders: {udid} {x1} {y1} {x2} {y2} {duration} */
  swipe: string
  /** Placeholders: {udid}. Must PRINT the accessibility hierarchy. */
  describe: string
  /** Placeholders: {udid} {text} */
  text?: string
}

/**
 * `fb-idb` — the injector that works headless and at a locked login screen,
 * which is why narduk-libs#70 requirement 2 asks for this class of tool rather
 * than window-position clicking. Offered as a default, never auto-assumed: see
 * `resolveInjector`.
 */
export const IDB_INJECTOR_TEMPLATES: InjectorTemplates = {
  tap: 'idb ui tap --udid {udid} {x} {y}',
  swipe: 'idb ui swipe --udid {udid} --duration {duration} {x1} {y1} {x2} {y2}',
  describe: 'idb ui describe-all --udid {udid}',
  text: 'idb ui text --udid {udid} {text}',
}

/** The environment names a repository can set instead of passing templates. */
export const INJECTOR_ENV = {
  tap: 'JOURNEYS_TAP_CMD',
  swipe: 'JOURNEYS_SWIPE_CMD',
  describe: 'JOURNEYS_DESCRIBE_CMD',
  text: 'JOURNEYS_TEXT_CMD',
} as const

function run(command: string, args: string[], label: string): string {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(0, 400)
    throw new Error(`${label} failed (${String(result.status)}): ${detail}`)
  }
  return result.stdout ?? ''
}

function fill(template: string, values: Record<string, string>): string[] {
  let filled = template
  for (const [key, value] of Object.entries(values)) {
    filled = filled.replaceAll(`{${key}}`, value)
  }
  const parts = filled.split(/\s+/).filter(Boolean)
  if (parts.length === 0) throw new Error(`empty injector template: "${template}"`)
  return parts
}

export interface ResolveInjectorOptions {
  udid: string
  templates?: Partial<InjectorTemplates>
  env?: Record<string, string | undefined>
  /** Injected for tests; defaults to a PATH probe. */
  commandExists?: (command: string) => boolean
}

function pathProbe(command: string): boolean {
  return spawnSync('which', [command], { encoding: 'utf8' }).status === 0
}

/**
 * Produce an injector, or REFUSE (narduk-libs#70, requirement 2).
 *
 * There is no no-op fallback and there never will be. A capture stack that
 * carries on without a hand records a video of a home screen, which is green,
 * watchable, and evidence of nothing — the precise failure this package exists
 * to make impossible.
 */
export function resolveInjector(options: ResolveInjectorOptions): AppleInjector {
  const env = options.env ?? process.env
  const exists = options.commandExists ?? pathProbe
  const idbAvailable = exists('idb')
  const pick = (key: keyof InjectorTemplates): string | undefined =>
    options.templates?.[key] ??
    env[INJECTOR_ENV[key]] ??
    (idbAvailable ? IDB_INJECTOR_TEMPLATES[key] : undefined)

  const tap = pick('tap')
  const swipe = pick('swipe')
  const describe = pick('describe')
  const text = pick('text')
  const missing: string[] = []
  if (!tap) missing.push(INJECTOR_ENV.tap)
  if (!swipe) missing.push(INJECTOR_ENV.swipe)
  if (!describe) missing.push(INJECTOR_ENV.describe)
  if (!tap || !swipe || !describe) {
    throw new Error(
      'no gesture injector: an Apple journey cannot be driven, and this refuses to film a ' +
        `screen nobody pressed. Set ${missing.join(', ')} to command templates, pass ` +
        '`templates`, or install fb-idb (`idb`) so the documented defaults apply ' +
        `(${IDB_INJECTOR_TEMPLATES.tap}).`,
    )
  }

  const name = options.templates ? 'templates' : idbAvailable ? 'idb' : 'env-templates'
  const udid = options.udid
  return {
    name,
    tap(x, y) {
      const parts = fill(tap, { udid, x: String(Math.round(x)), y: String(Math.round(y)) })
      run(parts[0] as string, parts.slice(1), `tap ${String(x)},${String(y)}`)
    },
    swipe(from, to, duration = 0.4) {
      const parts = fill(swipe, {
        udid,
        x1: String(Math.round(from.x)),
        y1: String(Math.round(from.y)),
        x2: String(Math.round(to.x)),
        y2: String(Math.round(to.y)),
        duration: String(duration),
      })
      run(parts[0] as string, parts.slice(1), 'swipe')
    },
    type(value) {
      if (!text) {
        throw new Error(
          `this journey types text and no injector can: set ${INJECTOR_ENV.text} or pass a \`text\` template`,
        )
      }
      const parts = fill(text, { udid, text: value })
      run(parts[0] as string, parts.slice(1), 'type')
    },
    describe() {
      const parts = fill(describe, { udid })
      return run(parts[0] as string, parts.slice(1), 'describe')
    },
  }
}

/** Resolve a simulator by NAME to exactly one udid, or refuse. */
export function resolveSimulatorUdid(deviceName: string): string {
  const listed = run('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], 'simctl list')
  const parsed = JSON.parse(listed) as { devices?: Record<string, Array<Record<string, unknown>>> }
  const matches: string[] = []
  for (const devices of Object.values(parsed.devices ?? {})) {
    for (const device of devices) {
      if (device.name === deviceName && device.isAvailable !== false) {
        matches.push(String(device.udid))
      }
    }
  }
  if (matches.length === 0) throw new Error(`no available simulator named "${deviceName}"`)
  if (matches.length > 1) {
    throw new Error(
      `"${deviceName}" names ${String(matches.length)} available simulators (${matches.join(', ')}); ` +
        'pass the udid so the run cannot pick the wrong one',
    )
  }
  return matches[0] as string
}

/** The real boundary: `xcrun simctl`, on this host, against one device. */
export function createSimctlControl(udid: string): SimulatorControl {
  const simctl = (args: string[], label: string): string => run('xcrun', ['simctl', ...args], label)
  return {
    udid,
    boot() {
      spawnSync('xcrun', ['simctl', 'boot', udid], { encoding: 'utf8' })
      simctl(['bootstatus', udid, '-b'], 'simctl bootstatus')
    },
    install(appPath) {
      simctl(['install', udid, appPath], 'simctl install')
    },
    terminate(bundleId) {
      spawnSync('xcrun', ['simctl', 'terminate', udid, bundleId], { encoding: 'utf8' })
    },
    launch(bundleId, args) {
      simctl(['launch', udid, bundleId, ...args], 'simctl launch')
    },
    pid(bundleId) {
      const result = spawnSync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'], {
        encoding: 'utf8',
      })
      if (result.status !== 0) return null
      const label = `UIKitApplication:${bundleId}`
      for (const line of (result.stdout ?? '').split('\n')) {
        if (!line.includes(label)) continue
        const pid = Number.parseInt(line.trim().split(/\s+/)[0] as string, 10)
        return Number.isFinite(pid) ? pid : null
      }
      return null
    },
    screenshot(path) {
      simctl(['io', udid, 'screenshot', path], 'simctl screenshot')
    },
    record(path) {
      rmSync(path, { force: true })
      const child = spawn(
        'xcrun',
        ['simctl', 'io', udid, 'recordVideo', '--codec', 'h264', '-f', path],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      )
      // recordVideo reports every failure on stderr and exits IMMEDIATELY —
      // most often `Resource busy`, what a previous run killed with SIGKILL
      // leaves behind. Swallowing this stream is how "no recording written"
      // becomes the only symptom of a host recorder nobody released.
      const noise: string[] = []
      child.stderr.on('data', (chunk: Buffer) => {
        const line = String(chunk).trim()
        if (line && !/^Note:|^Recording started/.test(line)) noise.push(line.slice(0, 200))
      })
      return {
        async stop() {
          if (child.exitCode === null) child.kill('SIGINT')
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              child.kill('SIGKILL')
              resolve()
            }, 15_000)
            child.on('exit', () => {
              clearTimeout(timer)
              resolve()
            })
            if (child.exitCode !== null) {
              clearTimeout(timer)
              resolve()
            }
          })
          if (!existsSync(path)) {
            throw new Error(
              `simctl recordVideo wrote nothing to ${path}${noise.length > 0 ? `: ${noise.join('; ')}` : ''}`,
            )
          }
        },
      }
    },
    describeDevice() {
      const listed = spawnSync('xcrun', ['simctl', 'list', 'devices', '-j'], { encoding: 'utf8' })
      if (listed.status !== 0) return { name: 'unknown', runtime: 'unknown' }
      const parsed = JSON.parse(listed.stdout ?? '{}') as {
        devices?: Record<string, Array<Record<string, unknown>>>
      }
      for (const [runtime, devices] of Object.entries(parsed.devices ?? {})) {
        for (const device of devices) {
          if (device.udid === udid) {
            return { name: String(device.name), runtime: runtime.split('.').pop() ?? runtime }
          }
        }
      }
      return { name: 'unknown', runtime: 'unknown' }
    },
  }
}
