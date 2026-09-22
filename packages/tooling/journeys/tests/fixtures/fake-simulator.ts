/**
 * The Apple adapter's two boundaries, faked.
 *
 * This is what lets the orchestration be proved on a Linux CI runner with no
 * simulator, no Xcode and no injector: the adapter talks to `SimulatorControl`
 * and `AppleInjector`, and the shell commands behind them are the only part
 * that needs a Mac. The simulator-dependent proof is a live run on a Mac; the
 * logic — sequencing, landing verification, pacing, manifests, refusals — is
 * proved here, on every push.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type {
  AppleElement,
  AppleInjector,
  Recording,
  SimulatorControl,
} from '../../src/apple-control.js'

export interface FakeScreen {
  /** The accessibility hierarchy, as the injector would print it. */
  tree: string
  /** The identified controls on this screen, as the injector would locate them. */
  elements?: AppleElement[]
  /** gesture key → the screen it leads to. A key absent here is a dead press. */
  on?: Record<string, string>
}

export interface FakeDeviceOptions {
  screens: Record<string, FakeScreen>
  start: string
}

export interface FakeDevice {
  control: SimulatorControl
  injector: AppleInjector
  /** Every gesture and describe, in order — how a test proves the modes agree. */
  log: string[]
  screenshots: string[]
  recordings: string[]
  current(): string
  /** Simulate the app being replaced under the journey. */
  setPid(pid: number | null): void
}

function key(kind: string, detail: string): string {
  return `${kind}:${detail}`
}

export function createFakeDevice(options: FakeDeviceOptions): FakeDevice {
  let screen = options.start
  let pid: number | null = 4242
  const log: string[] = []
  const screenshots: string[] = []
  const recordings: string[] = []

  const move = (gestureKey: string): void => {
    log.push(gestureKey)
    const next = options.screens[screen]?.on?.[gestureKey]
    if (next) screen = next
  }
  const write = (path: string, content: string): void => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }

  const control: SimulatorControl = {
    udid: 'FAKE-UDID-0001',
    boot() {
      log.push('boot')
    },
    install(appPath) {
      log.push(`install:${appPath}`)
    },
    terminate() {
      log.push('terminate')
    },
    launch(_bundleId, args) {
      log.push(`launch:${args.join(' ')}`)
      screen = options.start
      pid = pid ?? 4242
    },
    pid() {
      return pid
    },
    screenshot(path) {
      screenshots.push(path)
      write(path, `png:${screen}`)
    },
    record(path): Recording {
      recordings.push(path)
      log.push('record')
      return {
        async stop() {
          log.push('record:stop')
          write(path, `mp4:${screen}`)
          await Promise.resolve()
        },
      }
    },
    describeDevice() {
      return { name: 'Fake 16 Pro', runtime: 'iOS-26-0' }
    },
  }

  const injector: AppleInjector = {
    name: 'fake',
    tap(x, y) {
      move(key('tap', `${String(x)},${String(y)}`))
    },
    swipe(from, to) {
      move(key('swipe', `${String(from.x)},${String(from.y)}->${String(to.x)},${String(to.y)}`))
    },
    type(text) {
      move(key('type', text))
    },
    describe() {
      log.push('describe')
      return options.screens[screen]?.tree ?? ''
    },
    elements() {
      log.push('elements')
      return options.screens[screen]?.elements ?? []
    },
    key(name) {
      move(key('key', name))
    },
  }

  return {
    control,
    injector,
    log,
    screenshots,
    recordings,
    current: () => screen,
    setPid(value) {
      pid = value
    },
  }
}

/** A clock that advances only when something waits — so a test never sleeps. */
export function createFakeClock(startIso = '2026-08-25T09:00:00.000Z'): {
  now: () => number
  sleep: (ms: number) => Promise<void>
} {
  let clock = Date.parse(startIso)
  return {
    now: () => {
      clock += 50
      return clock
    },
    async sleep(ms) {
      clock += ms
      await Promise.resolve()
    },
  }
}
