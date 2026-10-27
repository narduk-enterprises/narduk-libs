import type { PostHog } from 'posthog-js'

export type AnalyticsProperties = Record<string, unknown>
export type AnalyticsStatus = 'pending' | 'ready' | 'disabled' | 'failed'
/** Why events were lost or held back. A closed vocabulary: never an id or a payload. */
export type AnalyticsLossReason =
  | 'consent_opt_out'
  | 'disabled'
  | 'identity_pending'
  | 'init_failed'
  | 'queue_expired'
  | 'queue_overflow'

/** Bounded delivery counters for one page load; numbers and one reason, nothing else. */
export interface AnalyticsDiagnostics {
  /** Dropped after a disable (collection never started, or turned off). */
  disabled: number
  /** Past the replay window, so not replayed. */
  expired: number
  /** Dropped because initialization or a send failed. */
  failed: number
  lastReason: AnalyticsLossReason | undefined
  /** Dropped because the visitor opted out of capturing. */
  optedOut: number
  /** Evicted from a full pre-initialization queue. */
  overflow: number
  /** Waiting for the SDK right now. */
  queued: number
  /** Handed to the SDK (including replays). */
  sent: number
  status: AnalyticsStatus
  /** Native SDK events nulled by the kit's own hook (identity pending, or not sending). */
  suppressed: number
}

type Client = { captureException?: PostHog['captureException'] } & Pick<
  PostHog,
  'capture' | 'identify' | 'reset' | 'register' | 'has_opted_out_capturing'
>
type Command =
  | { event: string; kind: 'capture'; properties: AnalyticsProperties; timestamp: Date }
  | { id: string; kind: 'identify'; properties?: AnalyticsProperties }
  | { kind: 'reset' }
  | { error: Error; kind: 'exception'; properties: AnalyticsProperties }

interface TransportOptions {
  context: () => AnalyticsProperties
  enabled: boolean
  /** Stamped on events that waited in the queue, so a delayed first event is visible. */
  loadStrategy?: string
  maxQueue?: number
  now?: () => number
  /** Clear persisted person state before replay when the session bridge owns identity. */
  resetOnAttach?: boolean
  /** Replay window per queued capture; `Infinity` never expires one. Default 30 s. */
  ttlMs?: number
}

/** One app-owned transport; pending initialization is different from intentionally disabled. */
export function createAnalyticsTransport(options: TransportOptions) {
  const now = options.now ?? Date.now
  const queue: Array<{ at: number; command: Command }> = []
  let client: Client | undefined
  let status: AnalyticsStatus = options.enabled ? 'pending' : 'disabled'
  const counts = { disabled: 0, expired: 0, failed: 0, optedOut: 0, overflow: 0, sent: 0 }
  let suppressed = 0
  let lastReason: AnalyticsLossReason | undefined
  const lose = (key: keyof typeof counts, reason: AnalyticsLossReason, n = 1) => {
    if (n <= 0) return
    counts[key] += n
    lastReason = reason
  }
  const dropped = () =>
    counts.disabled + counts.expired + counts.failed + counts.optedOut + counts.overflow
  const ttlMs = options.ttlMs ?? 30_000
  const maxQueue = options.maxQueue ?? 100

  function send(command: Command): boolean {
    if (!client || client.has_opted_out_capturing?.()) {
      if (client) lose('optedOut', 'consent_opt_out', queue.length + 1)
      else lose('failed', 'init_failed', queue.length + 1)
      queue.length = 0
      return false
    }
    try {
      if (command.kind === 'capture')
        client.capture(command.event, command.properties, { timestamp: command.timestamp })
      else if (command.kind === 'identify') client.identify(command.id, command.properties)
      else if (command.kind === 'exception') {
        if (!client.captureException) {
          lose('failed', 'init_failed')
          return false
        }
        client.captureException(command.error, command.properties)
      } else {
        client.reset()
        client.register(options.context())
      }
      counts.sent += 1
      return true
    } catch {
      lose('failed', 'init_failed')
      if (command.kind === 'identify' || command.kind === 'reset') {
        status = 'failed'
        client = undefined
        lose('failed', 'init_failed', queue.length)
        queue.length = 0
      }
      return false
    }
  }

  function dispatch(command: Command): boolean {
    if (status === 'ready') return send(command)
    if (status === 'disabled') {
      lose('disabled', 'disabled')
      return false
    }
    if (status !== 'pending') {
      lose('failed', 'init_failed')
      return false
    }
    if (queue.length >= maxQueue && !evictOldestCapture()) {
      // Only identity barriers are queued: skipping one is unsafe, so fail closed.
      lose('overflow', 'queue_overflow', queue.length + 1)
      queue.length = 0
      status = 'failed'
      return false
    }
    queue.push({ command, at: now() })
    return true
  }

  /**
   * A long pre-input visit must not fail the whole page load. Evict the oldest
   * non-pageview capture first so the landing pageview survives; identity
   * barriers are never evicted, because events either side of one depend on it.
   */
  function evictOldestCapture(): boolean {
    const isEvictable = (entry: { command: Command }, keepPageview: boolean) =>
      (entry.command.kind === 'capture' || entry.command.kind === 'exception') &&
      !(keepPageview && entry.command.kind === 'capture' && entry.command.event === '$pageview')
    let index = queue.findIndex((entry) => isEvictable(entry, true))
    if (index < 0) index = queue.findIndex((entry) => isEvictable(entry, false))
    if (index < 0) return false
    queue.splice(index, 1)
    lose('overflow', 'queue_overflow')
    return true
  }

  return {
    get status() {
      return status
    },
    get dropped() {
      return dropped()
    },
    /** Bounded delivery counters. No ids, no payloads, no network. */
    diagnostics(): AnalyticsDiagnostics {
      return {
        disabled: counts.disabled,
        expired: counts.expired,
        failed: counts.failed,
        lastReason,
        optedOut: counts.optedOut,
        overflow: counts.overflow,
        queued: queue.length,
        sent: counts.sent,
        status,
        suppressed,
      }
    },
    /** The plugin's SDK hook nulled a native event (identity pending, or not sending). */
    suppress(reason: AnalyticsLossReason) {
      suppressed += 1
      lastReason = reason
    },
    get queued() {
      return queue.length
    },
    context: options.context,
    capture(event: string, properties: AnalyticsProperties = {}, context = options.context()) {
      try {
        return dispatch({
          kind: 'capture',
          event,
          properties: structuredClone({ ...properties, ...context }),
          timestamp: new Date(now()),
        })
      } catch {
        lose('failed', 'init_failed')
        return false
      }
    },
    captureException(error: Error, properties: AnalyticsProperties = {}) {
      return dispatch({
        kind: 'exception',
        error,
        properties: { ...options.context(), ...properties },
      })
    },
    identify(id: string, properties?: AnalyticsProperties) {
      try {
        return dispatch({
          kind: 'identify',
          id,
          properties: properties ? structuredClone(properties) : undefined,
        })
      } catch {
        lose('failed', 'init_failed')
        return false
      }
    },
    reset() {
      return dispatch({ kind: 'reset' })
    },
    attach(value: Client) {
      if (status !== 'pending') return
      client = value
      status = 'ready'
      try {
        if (options.resetOnAttach) client.reset()
        client.register(options.context())
      } catch {
        lose('failed', 'init_failed', queue.length)
        queue.length = 0
        client = undefined
        status = 'failed'
        return
      }
      const attachedAt = now()
      const expired = (entry: { at: number }) => attachedAt - entry.at > ttlMs
      // An expired identity command cannot safely be replayed or skipped on its
      // own, so it keeps the all-or-nothing rule. Anything else expires one
      // entry at a time and the rest replays.
      if (queue.some((entry) => expired(entry) && isBarrier(entry.command))) {
        lose('expired', 'queue_expired', queue.length)
        queue.length = 0
        status = 'failed'
        client = undefined
        return
      }
      const pending = queue.splice(0)
      const lostBeforeInit = pending.filter(expired).length
      lose('expired', 'queue_expired', lostBeforeInit)
      const replay = pending.filter((entry) => !expired(entry))
      for (const [index, entry] of replay.entries()) {
        const { command } = entry
        if (command.kind === 'capture') {
          // The event keeps its own timestamp; these say it was held back and why.
          command.properties = {
            ...command.properties,
            analytics_queue_delay_ms: Math.max(0, attachedAt - entry.at),
            ...(options.loadStrategy ? { analytics_load_strategy: options.loadStrategy } : {}),
            ...(index === 0 && dropped() > 0 ? { analytics_queue_lost: dropped() } : {}),
          }
        }
        send(command)
      }
    },
    disable() {
      lose('disabled', 'disabled', queue.length)
      queue.length = 0
      status = 'disabled'
      client = undefined
    },
    fail() {
      lose('failed', 'init_failed', queue.length)
      queue.length = 0
      status = 'failed'
      client = undefined
    },
  }
}

function isBarrier(command: Command): boolean {
  return command.kind === 'identify' || command.kind === 'reset'
}

export type AnalyticsTransport = ReturnType<typeof createAnalyticsTransport>
