/**
 * `broadcastSSE` drops a connection whose write fails, whether the writer
 * throws or -- the normal case for a closed or errored stream -- rejects the
 * promise `write()` returns (narduk-libs#870).
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  broadcastSSE,
  getSSEConnectionCount,
  getSSETotalConnections,
  registerSSE,
  removeSSE,
} from '../runtime/server/utils/sse'

import type { SSEConnection } from '../runtime/server/utils/sse'

const CHANNEL = 'channel-870'
const registered: SSEConnection[] = []

function register(writer: WritableStreamDefaultWriter) {
  const conn = registerSSE(CHANNEL, writer)
  registered.push(conn)
  return conn
}

/** A live stream whose reader collects every chunk it is sent. */
function liveConnection() {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const chunks: string[] = []
  const decoder = new TextDecoder()
  void readable.pipeTo(
    new WritableStream({ write: (chunk) => void chunks.push(decoder.decode(chunk)) }),
  )
  return { conn: register(writable.getWriter()), chunks }
}

/** Lets the stream machinery settle the writes a broadcast started. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('broadcastSSE', () => {
  afterEach(() => {
    for (const conn of registered.splice(0)) removeSSE(conn.channelId, conn)
  })

  it('delivers the event to a live connection and keeps it registered', async () => {
    const { chunks } = liveConnection()
    broadcastSSE(CHANNEL, 'job:complete', { id: '123' })
    await settle()
    expect(chunks.join('')).toBe('event: job:complete\ndata: {"id":"123"}\n\n')
    expect(getSSEConnectionCount(CHANNEL)).toBe(1)
  })

  it('removes a connection whose client went away (the write rejects)', async () => {
    const live = liveConnection()
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    await readable.cancel(new Error('client disconnected'))
    register(writable.getWriter())
    expect(getSSEConnectionCount(CHANNEL)).toBe(2)

    broadcastSSE(CHANNEL, 'tick', 1)
    await settle()

    expect(getSSEConnectionCount(CHANNEL)).toBe(1)
    expect(live.chunks.join('')).toBe('event: tick\ndata: 1\n\n')

    // A later broadcast no longer writes to the dead stream.
    broadcastSSE(CHANNEL, 'tick', 2)
    await settle()
    expect(getSSEConnectionCount(CHANNEL)).toBe(1)
  })

  it('removes a closed writer and drops an emptied channel', async () => {
    const { writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    register(writer)
    await writer.close()

    broadcastSSE(CHANNEL, 'tick', 1)
    await settle()

    expect(getSSEConnectionCount(CHANNEL)).toBe(0)
    expect(getSSETotalConnections()).toBe(0)
  })

  it('removes a writer that throws synchronously', () => {
    const writer = {
      write: () => {
        throw new TypeError('writer released')
      },
    } as unknown as WritableStreamDefaultWriter
    register(writer)

    broadcastSSE(CHANNEL, 'tick', 1)

    expect(getSSEConnectionCount(CHANNEL)).toBe(0)
  })

  it('a late rejection removes only the connection whose write failed', async () => {
    const { writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    const dead = register(writer)
    await writer.close()

    broadcastSSE(CHANNEL, 'tick', 1)
    removeSSE(CHANNEL, dead)
    liveConnection()
    await settle()

    expect(getSSEConnectionCount(CHANNEL)).toBe(1)
  })
})
