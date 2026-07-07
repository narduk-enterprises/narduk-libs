/**
 * sse.ts — Per-isolate SSE connection registry.
 *
 * Manages SSE (Server-Sent Events) connections grouped by channel ID
 * (e.g. a user ID, room ID, or job ID). Broadcasts events to all
 * connected clients on a channel.
 *
 * On Cloudflare Workers, each isolate has its own connection map.
 * This works well for single-instance dev and small-scale deployments.
 * For multi-instance production, pair with a polling/cron fallback
 * for eventual consistency.
 *
 * @example
 * ```ts
 * // SSE endpoint: server/api/events.get.ts
 * export default defineEventHandler(async (event) => {
 *   const userId = '...'
 *   const { readable, writable } = new TransformStream()
 *   const writer = writable.getWriter()
 *   const conn = registerSSE(userId, writer)
 *
 *   event.node.req.on('close', () => removeSSE(userId, conn))
 *
 *   return new Response(readable, {
 *     headers: {
 *       'Content-Type': 'text/event-stream',
 *       'Cache-Control': 'no-cache',
 *       'Connection': 'keep-alive',
 *     },
 *   })
 * })
 *
 * // Broadcasting from another route:
 * broadcastSSE(userId, 'job:complete', { id: '123', status: 'done' })
 * ```
 */

/** A single SSE connection bound to a channel. */
export interface SSEConnection {
  channelId: string
  writer: WritableStreamDefaultWriter
}

const _channels = new Map<string, Set<SSEConnection>>()
const _encoder = new TextEncoder()

/**
 * Register an SSE connection on a channel.
 * Returns the connection handle needed for `removeSSE`.
 */
export function registerSSE(channelId: string, writer: WritableStreamDefaultWriter): SSEConnection {
  const conn: SSEConnection = { writer, channelId }
  let set = _channels.get(channelId)
  if (!set) {
    set = new Set()
    _channels.set(channelId, set)
  }
  set.add(conn)
  return conn
}

/**
 * Remove a previously registered SSE connection.
 * Safe to call multiple times or with an already-removed connection.
 */
export function removeSSE(channelId: string, conn: SSEConnection): void {
  const set = _channels.get(channelId)
  if (!set) return
  set.delete(conn)
  if (set.size === 0) _channels.delete(channelId)
}

/**
 * Broadcast an SSE event to all connections on a channel.
 * Dead connections (write throws) are automatically removed.
 *
 * @param channelId - Channel to broadcast on (e.g. userId, roomId)
 * @param event     - SSE event name (appears as `event:` line)
 * @param data      - Payload (will be JSON.stringify'd)
 */
export function broadcastSSE(channelId: string, event: string, data: unknown): void {
  const set = _channels.get(channelId)
  if (!set || set.size === 0) return

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const encoded = _encoder.encode(message)

  const dead: SSEConnection[] = []
  for (const conn of set) {
    try {
      void conn.writer.write(encoded)
    } catch {
      dead.push(conn)
    }
  }

  for (const conn of dead) {
    set.delete(conn)
  }
  if (set.size === 0) _channels.delete(channelId)
}

/**
 * Get the number of active connections on a channel.
 */
export function getSSEConnectionCount(channelId: string): number {
  return _channels.get(channelId)?.size ?? 0
}

/**
 * Get total connection count across all channels.
 * Useful for health/diagnostics endpoints.
 */
export function getSSETotalConnections(): number {
  let total = 0
  for (const set of _channels.values()) {
    total += set.size
  }
  return total
}
