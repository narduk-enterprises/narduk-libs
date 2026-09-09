import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HibernatingDurableObject } from '../src/server/durable-object.js'

interface FakeSocket {
  readonly sent: Array<string | ArrayBuffer>
  readonly closes: Array<{ code: number; reason: string }>
  send: (message: string | ArrayBuffer) => void
  close: (code: number, reason: string) => void
}

class AutoResponsePair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}

function fakeSocket(options: { failing?: boolean } = {}): FakeSocket {
  const socket: FakeSocket = {
    sent: [],
    closes: [],
    send(message) {
      if (options.failing) throw new Error('socket is gone')
      socket.sent.push(message)
    },
    close(code, reason) {
      socket.closes.push({ code, reason })
    },
  }
  return socket
}

/** Minimal `DurableObjectState` double: tag bookkeeping and the auto-response. */
function fakeCtx() {
  const tagged: Array<{ socket: FakeSocket; tags: string[] }> = []
  return {
    autoResponse: undefined as AutoResponsePair | undefined,
    tagged,
    setWebSocketAutoResponse(pair: AutoResponsePair) {
      this.autoResponse = pair
    },
    acceptWebSocket(socket: FakeSocket, tags: string[]) {
      tagged.push({ socket, tags })
    },
    getWebSockets(tag?: string) {
      return tagged
        .filter((entry) => tag === undefined || entry.tags.includes(tag))
        .map((entry) => entry.socket)
    },
  }
}

/** Exposes the protected helper surface for assertion. */
class TestDurableObject extends HibernatingDurableObject {
  accept(ws: FakeSocket, tags: readonly string[]): void {
    this.acceptTagged(ws as unknown as WebSocket, tags)
  }

  sockets(tag: string): WebSocket[] {
    return this.socketsWithTag(tag)
  }

  send(tag: string, message: string): number {
    return this.broadcast(tag, message)
  }

  counts(tags: readonly string[]): Record<string, number> {
    return this.sessionCounts(tags)
  }
}

function makeObject(): { ctx: ReturnType<typeof fakeCtx>; object: TestDurableObject } {
  const ctx = fakeCtx()
  return {
    ctx,
    object: new TestDurableObject(ctx as unknown as DurableObjectState, {}),
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocketRequestResponsePair', AutoResponsePair)
  return () => {
    vi.unstubAllGlobals()
  }
})

describe('HibernatingDurableObject', () => {
  // The cost rule the class exists to enforce: a keepalive ping is answered by
  // the runtime while the object is hibernated, so an idle session never wakes
  // it and never accrues duration (company-hq D-PAVED-1, web-cf stack note).
  it('installs the runtime ping/pong auto-response on construction', () => {
    const { ctx } = makeObject()

    expect(ctx.autoResponse).toBeInstanceOf(AutoResponsePair)
    expect(ctx.autoResponse?.request).toBe('ping')
    expect(ctx.autoResponse?.response).toBe('pong')
  })

  it('accepts sockets in hibernatable mode with their tags', () => {
    const { ctx, object } = makeObject()
    const socket = fakeSocket()

    object.accept(socket, ['viewer', 'tenant:7'])

    expect(ctx.tagged).toEqual([{ socket, tags: ['viewer', 'tenant:7'] }])
  })

  it('reads sessions back from the runtime by tag', () => {
    const { object } = makeObject()
    const viewer = fakeSocket()
    const edge = fakeSocket()

    object.accept(viewer, ['viewer'])
    object.accept(edge, ['edge'])

    expect(object.sockets('viewer')).toEqual([viewer])
    expect(object.sockets('edge')).toEqual([edge])
    expect(object.sockets('missing')).toEqual([])
  })

  it('broadcasts to every socket carrying the tag', () => {
    const { object } = makeObject()
    const first = fakeSocket()
    const second = fakeSocket()
    const other = fakeSocket()

    object.accept(first, ['viewer'])
    object.accept(second, ['viewer'])
    object.accept(other, ['edge'])

    expect(object.send('viewer', 'telemetry')).toBe(2)
    expect(first.sent).toEqual(['telemetry'])
    expect(second.sent).toEqual(['telemetry'])
    expect(other.sent).toEqual([])
  })

  it('keeps fanning out when one peer has already gone away', () => {
    const { object } = makeObject()
    const dead = fakeSocket({ failing: true })
    const alive = fakeSocket()

    object.accept(dead, ['viewer'])
    object.accept(alive, ['viewer'])

    expect(object.send('viewer', 'telemetry')).toBe(1)
    expect(alive.sent).toEqual(['telemetry'])
  })

  it('reports a session count per tag', () => {
    const { object } = makeObject()

    object.accept(fakeSocket(), ['viewer'])
    object.accept(fakeSocket(), ['viewer'])
    object.accept(fakeSocket(), ['edge'])

    expect(object.counts(['viewer', 'edge', 'admin'])).toEqual({
      viewer: 2,
      edge: 1,
      admin: 0,
    })
  })

  it('completes the closing handshake with the peer code', () => {
    const { object } = makeObject()
    const socket = fakeSocket()

    object.webSocketClose(socket as unknown as WebSocket, 1001, 'going away', true)

    expect(socket.closes).toEqual([{ code: 1001, reason: 'going away' }])
  })

  // 1005/1006 are runtime-only codes; WebSocket#close() throws on either, so
  // echoing a dropped connection's code without this guard turns an ordinary
  // disconnect into a Durable Object exception.
  it.each([1005, 1006])('substitutes a normal closure for reserved code %i', (code) => {
    const { object } = makeObject()
    const socket = fakeSocket()

    object.webSocketClose(socket as unknown as WebSocket, code, 'abnormal', false)

    expect(socket.closes).toEqual([{ code: 1000, reason: 'abnormal' }])
  })
})
