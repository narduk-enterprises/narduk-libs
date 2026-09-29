import type { PostHog } from 'posthog-js'

export type AnalyticsProperties = Record<string, unknown>
export type AnalyticsStatus = 'pending' | 'ready' | 'disabled' | 'failed'
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
  maxQueue?: number
  now?: () => number
  ttlMs?: number
}

/** One app-owned transport; pending initialization is different from intentionally disabled. */
export function createAnalyticsTransport(options: TransportOptions) {
  const now = options.now ?? Date.now
  const queue: Array<{ at: number; command: Command }> = []
  let client: Client | undefined
  let status: AnalyticsStatus = options.enabled ? 'pending' : 'disabled'
  let dropped = 0
  const ttlMs = options.ttlMs ?? 30_000
  const maxQueue = options.maxQueue ?? 100

  function send(command: Command): boolean {
    if (!client || client.has_opted_out_capturing?.()) {
      dropped += queue.length + 1
      queue.length = 0
      return false
    }
    try {
      if (command.kind === 'capture')
        client.capture(command.event, command.properties, { timestamp: command.timestamp })
      else if (command.kind === 'identify') client.identify(command.id, command.properties)
      else if (command.kind === 'exception') {
        if (!client.captureException) return false
        client.captureException(command.error, command.properties)
      } else {
        client.reset()
        client.register(options.context())
      }
      return true
    } catch {
      dropped += 1
      if (command.kind === 'identify' || command.kind === 'reset') {
        status = 'failed'
        client = undefined
        dropped += queue.length
        queue.length = 0
      }
      return false
    }
  }

  function dispatch(command: Command): boolean {
    if (status === 'ready') return send(command)
    if (status !== 'pending') return false
    // Identity barriers must never be dropped while retaining events either side.
    if (queue.length >= maxQueue) {
      dropped += queue.length + 1
      queue.length = 0
      status = 'failed'
      return false
    }
    queue.push({ command, at: now() })
    return true
  }

  return {
    get status() {
      return status
    },
    get dropped() {
      return dropped
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
        dropped += 1
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
        dropped += 1
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
        client.register(options.context())
      } catch {
        dropped += queue.length
        queue.length = 0
        client = undefined
        status = 'failed'
        return
      }
      // Expired identity commands cannot safely be replayed or skipped independently.
      if (queue.some((entry) => now() - entry.at > ttlMs)) {
        dropped += queue.length
        queue.length = 0
      }
      const pending = queue.splice(0)
      for (const entry of pending) send(entry.command)
    },
    disable() {
      dropped += queue.length
      queue.length = 0
      status = 'disabled'
      client = undefined
    },
    fail() {
      dropped += queue.length
      queue.length = 0
      status = 'failed'
      client = undefined
    },
  }
}

export type AnalyticsTransport = ReturnType<typeof createAnalyticsTransport>
