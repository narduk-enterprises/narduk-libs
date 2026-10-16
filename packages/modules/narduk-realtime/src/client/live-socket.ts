/**
 * A browser (or any runtime with a `WebSocket`) client for a socket served by
 * {@link HibernatingDurableObject}: connect, keep alive, reconnect, and hand
 * every frame to the caller. Framework-free on purpose: a Vue or React app
 * wraps it in its own few-line composable.
 *
 * ## Cost rule
 *
 * The keepalive is the exact text `ping`, which the base class's
 * auto-response answers with `pong` while the object hibernates, so an idle
 * client never wakes the object. Any other keepalive text would wake it every
 * interval. The client sends nothing else.
 *
 * ## Delivery rule
 *
 * A push socket is a hint, never the record. Frames sent while the client was
 * disconnected are gone, so the caller must re-read its data when the socket
 * opens (`onState('open')`) and keep a slow fallback poll; this client only
 * reports state and frames.
 */

/** The `WebSocket` surface the client uses: the browser's, Node's and the Workers runtime's all satisfy it. */
export interface LiveSocketLike {
  addEventListener(type: 'close' | 'error' | 'open', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  close(code?: number, reason?: string): void
  readonly readyState: number
  send(data: string): void
}

export type LiveSocketConstructor = new (url: string) => LiveSocketLike

/** `connecting` while a handshake is in flight, `open` once it completed, `closed` while waiting to retry, `stopped` after `stop()`. */
export type LiveSocketState = 'closed' | 'connecting' | 'open' | 'stopped'

export interface LiveSocketOptions {
  /** The `ws:` or `wss:` URL, or a function returning it (read on every connect). */
  url: string | (() => string)
  /** Every frame that parsed as JSON, other than the `pong` keepalive answer. */
  onFrame: (frame: unknown) => void
  /** Every state change, including the first `connecting`. */
  onState?: (state: LiveSocketState) => void
  /** Keepalive interval. Default 30 s. */
  pingMs?: number
  /** A socket that has heard nothing (not even `pong`) for this long is treated as dead and replaced. Default 2.5 x `pingMs`. */
  deadMs?: number
  /** First retry delay; doubles per consecutive failure. Default 1 s. */
  minBackoffMs?: number
  /** Retry delay ceiling. Default 60 s. */
  maxBackoffMs?: number
  /** Defaults to `globalThis.WebSocket`. */
  WebSocket?: LiveSocketConstructor
  /** Jitter source in [0, 1). Defaults to `Math.random`. */
  random?: () => number
  /** Clock in ms. Defaults to `Date.now`. */
  now?: () => number
}

export interface LiveSocket {
  /** Connect (no-op while connecting or open). Starting again after `stop()` is allowed. */
  start(): void
  /** Close the socket and cancel every timer; no reconnect follows. */
  stop(): void
  /** The current state. */
  state(): LiveSocketState
}

/** The keepalive pair the base class installs. */
export const LIVE_SOCKET_PING = 'ping'
export const LIVE_SOCKET_PONG = 'pong'

const OPEN = 1

/** The delay before retry number `failures` (1-based): min x 2^(failures-1), capped, with +-20 % jitter. */
export function liveSocketBackoff(
  failures: number,
  minMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(minMs * 2 ** Math.max(0, failures - 1), maxMs)
  return Math.round(base * (0.8 + 0.4 * random()))
}

export function createLiveSocket(options: LiveSocketOptions): LiveSocket {
  const pingMs = options.pingMs ?? 30_000
  const deadMs = options.deadMs ?? Math.round(pingMs * 2.5)
  const minBackoffMs = options.minBackoffMs ?? 1000
  const maxBackoffMs = options.maxBackoffMs ?? 60_000
  const random = options.random ?? Math.random
  const now = options.now ?? Date.now
  const Impl =
    options.WebSocket ?? (globalThis as unknown as { WebSocket?: LiveSocketConstructor }).WebSocket

  let current: LiveSocketState = 'stopped'
  let socket: LiveSocketLike | null = null
  let failures = 0
  let lastHeard = 0
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function setState(next: LiveSocketState) {
    if (next === current) return
    current = next
    options.onState?.(next)
  }

  function clearTimers() {
    if (pingTimer !== null) clearInterval(pingTimer)
    if (retryTimer !== null) clearTimeout(retryTimer)
    pingTimer = null
    retryTimer = null
  }

  /** The socket is gone (closed, errored or found dead): drop it and schedule the next attempt. */
  function lost(target: LiveSocketLike) {
    // A replaced socket's late events land here too; only the current one counts.
    if (target !== socket) return
    socket = null
    clearTimers()
    if (current === 'stopped') return
    try {
      target.close()
    } catch {
      // Already closed.
    }
    failures += 1
    setState('closed')
    retryTimer = setTimeout(
      connect,
      liveSocketBackoff(failures, minBackoffMs, maxBackoffMs, random),
    )
  }

  function connect() {
    retryTimer = null
    if (current === 'stopped' || socket) return
    if (!Impl) {
      setState('closed')
      return
    }
    setState('connecting')
    let target: LiveSocketLike
    try {
      target = new Impl(typeof options.url === 'function' ? options.url() : options.url)
    } catch {
      failures += 1
      setState('closed')
      retryTimer = setTimeout(
        connect,
        liveSocketBackoff(failures, minBackoffMs, maxBackoffMs, random),
      )
      return
    }
    socket = target
    target.addEventListener('open', () => {
      if (target !== socket) return
      failures = 0
      lastHeard = now()
      setState('open')
      pingTimer = setInterval(() => {
        if (target !== socket) return
        if (now() - lastHeard > deadMs) return lost(target)
        try {
          if (target.readyState === OPEN) target.send(LIVE_SOCKET_PING)
        } catch {
          lost(target)
        }
      }, pingMs)
    })
    target.addEventListener('message', (event) => {
      if (target !== socket) return
      lastHeard = now()
      if (typeof event.data !== 'string' || event.data === LIVE_SOCKET_PONG) return
      let frame: unknown
      try {
        frame = JSON.parse(event.data)
      } catch {
        return
      }
      options.onFrame(frame)
    })
    target.addEventListener('close', () => lost(target))
    target.addEventListener('error', () => lost(target))
  }

  return {
    start() {
      if (current !== 'stopped') return
      current = 'closed'
      failures = 0
      connect()
    },
    stop() {
      const target = socket
      socket = null
      clearTimers()
      setState('stopped')
      if (target) {
        try {
          target.close(1000, 'stopped')
        } catch {
          // Already closed.
        }
      }
    },
    state: () => current,
  }
}
