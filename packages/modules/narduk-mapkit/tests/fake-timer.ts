import type {
  MapKitFrameScheduler,
  MapKitTimerHandle,
  MapKitTimerScheduler,
} from '../src/client/timers.js'

export interface FakeTimer extends MapKitTimerScheduler {
  /** Run every callback due within `ms`, then set the clock to that instant. */
  advance: (ms: number) => void
  /** Number of scheduled callbacks that have not run or been cancelled. */
  pending: () => number
}

/**
 * A deterministic scheduler for the temporal controller and pointer probe.
 * Callbacks fire in due order, and `now()` reports the simulated instant a
 * callback ran at rather than the end of the advanced window.
 */
export function createFakeTimer(startMs = 0): FakeTimer {
  const tasks = new Map<number, { at: number; run: () => void }>()
  let current = startMs
  let nextHandle = 1

  return {
    advance(ms: number): void {
      const target = current + ms
      for (;;) {
        let dueHandle: number | null = null
        let dueAt = Number.POSITIVE_INFINITY
        for (const [handle, task] of tasks) {
          if (task.at <= target && task.at < dueAt) {
            dueAt = task.at
            dueHandle = handle
          }
        }
        if (dueHandle === null) break
        const task = tasks.get(dueHandle)!
        tasks.delete(dueHandle)
        current = task.at
        task.run()
      }
      current = target
    },
    cancel(handle: MapKitTimerHandle): void {
      tasks.delete(handle as number)
    },
    now: () => current,
    pending: () => tasks.size,
    schedule(callback: () => void, delayMs: number): MapKitTimerHandle {
      const handle = nextHandle++
      tasks.set(handle, { at: current + Math.max(0, delayMs), run: callback })
      return handle
    },
  }
}

/** Let queued promise callbacks settle without touching the fake clock. */
export async function flushMicrotasks(): Promise<void> {
  for (let pass = 0; pass < 8; pass++) await Promise.resolve()
}

export interface FakeFrameScheduler extends MapKitFrameScheduler {
  /** Number of frame callbacks queued and not yet run or cancelled. */
  pending: () => number
  /** Run every callback queued right now, once, with an advancing timestamp. */
  runFrame: () => void
}

/**
 * A deterministic animation-frame source for the render scheduler. Callbacks
 * queued during a frame wait for the next `runFrame()` rather than running
 * inside the current one, which is how a real browser paces them.
 */
export function createFakeFrameScheduler(startMs = 0): FakeFrameScheduler {
  const frames = new Map<number, FrameRequestCallback>()
  let nextHandle = 1
  let timestamp = startMs

  return {
    cancelAnimationFrame(handle: number): void {
      frames.delete(handle)
    },
    pending: () => frames.size,
    requestAnimationFrame(callback: FrameRequestCallback): number {
      const handle = nextHandle++
      frames.set(handle, callback)
      return handle
    },
    runFrame(): void {
      const due = [...frames.values()]
      frames.clear()
      timestamp += 16
      for (const callback of due) callback(timestamp)
    },
  }
}
