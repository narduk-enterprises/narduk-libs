import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createLiveSocket,
  liveSocketBackoff,
  type LiveSocketLike,
  type LiveSocketState,
} from '../src/client/live-socket.js'

type Listener = (event: { data: unknown }) => void

class FakeSocket implements LiveSocketLike {
  static all: FakeSocket[] = []
  listeners = new Map<string, Listener[]>()
  readyState = 0
  sent: string[] = []
  closed = false
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.emit('open')
  }
  message(data: unknown) {
    this.emit('message', data)
  }
  drop() {
    this.readyState = 3
    this.emit('close')
  }
}

let clock = 0
function client(extra: Partial<Parameters<typeof createLiveSocket>[0]> = {}) {
  const frames: unknown[] = []
  const states: LiveSocketState[] = []
  const socket = createLiveSocket({
    url: 'wss://example.test/live',
    onFrame: (frame) => frames.push(frame),
    onState: (state) => states.push(state),
    WebSocket: FakeSocket,
    random: () => 0.5,
    now: () => clock,
    ...extra,
  })
  return { socket, frames, states }
}

beforeEach(() => {
  FakeSocket.all = []
  clock = 0
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('liveSocketBackoff', () => {
  it('doubles from the minimum, caps at the maximum, and jitters by at most 20 %', () => {
    expect(liveSocketBackoff(1, 1000, 60_000, () => 0.5)).toBe(1000)
    expect(liveSocketBackoff(3, 1000, 60_000, () => 0.5)).toBe(4000)
    expect(liveSocketBackoff(20, 1000, 60_000, () => 0.5)).toBe(60_000)
    expect(liveSocketBackoff(1, 1000, 60_000, () => 0)).toBe(800)
    expect(liveSocketBackoff(1, 1000, 60_000, () => 0.999_999)).toBe(1200)
  })
})

describe('createLiveSocket', () => {
  it('connects, reports open, and hands parsed frames to the caller', () => {
    const { socket, frames, states } = client()
    socket.start()
    expect(states).toEqual(['connecting'])
    FakeSocket.all[0]!.open()
    expect(socket.state()).toBe('open')
    FakeSocket.all[0]!.message('{"type":"lane","id":"x"}')
    expect(frames).toEqual([{ type: 'lane', id: 'x' }])
  })

  it('ignores pong, non-JSON and non-string data', () => {
    const { socket, frames } = client()
    socket.start()
    FakeSocket.all[0]!.open()
    FakeSocket.all[0]!.message('pong')
    FakeSocket.all[0]!.message('not json')
    FakeSocket.all[0]!.message(new ArrayBuffer(2))
    expect(frames).toEqual([])
  })

  it('pings with the exact auto-response text, nothing else', () => {
    const { socket } = client({ pingMs: 30_000 })
    socket.start()
    const fake = FakeSocket.all[0]!
    fake.open()
    clock = 30_000
    fake.message('pong')
    vi.advanceTimersByTime(30_000)
    clock = 60_000
    fake.message('pong')
    vi.advanceTimersByTime(30_000)
    expect(fake.sent).toEqual(['ping', 'ping'])
  })

  it('replaces a socket that has heard nothing for the dead interval', () => {
    const { socket, states } = client({ pingMs: 30_000 })
    socket.start()
    FakeSocket.all[0]!.open()
    clock = 80_000
    vi.advanceTimersByTime(30_000)
    expect(FakeSocket.all[0]!.closed).toBe(true)
    expect(states.at(-1)).toBe('closed')
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('reconnects with growing backoff and resets it after an open', () => {
    const { socket } = client()
    socket.start()
    FakeSocket.all[0]!.drop()
    vi.advanceTimersByTime(999)
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1]!.drop()
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(3)
    FakeSocket.all[2]!.open()
    clock = 30_000
    FakeSocket.all[2]!.message('pong')
    vi.advanceTimersByTime(30_000)
    FakeSocket.all[2]!.drop()
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(4)
  })

  it('keeps backing off when a server accepts and then closes at once', () => {
    const { socket } = client()
    socket.start()
    for (const [index, wait] of [1000, 2000, 4000, 8000].entries()) {
      FakeSocket.all[index]!.open()
      FakeSocket.all[index]!.message('{"type":"hello"}')
      FakeSocket.all[index]!.drop()
      vi.advanceTimersByTime(wait - 1)
      expect(FakeSocket.all).toHaveLength(index + 1)
      vi.advanceTimersByTime(1)
      expect(FakeSocket.all).toHaveLength(index + 2)
    }
  })

  it('abandons a handshake that never completes', () => {
    const { socket, states } = client({ connectTimeoutMs: 15_000 })
    socket.start()
    vi.advanceTimersByTime(15_000)
    expect(FakeSocket.all[0]!.closed).toBe(true)
    expect(states.at(-1)).toBe('closed')
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('ignores a replaced socket: a late open, frame or close changes nothing', () => {
    const { socket, frames, states } = client()
    socket.start()
    const first = FakeSocket.all[0]!
    socket.stop()
    first.open()
    first.message('{"type":"lane"}')
    first.drop()
    expect(frames).toEqual([])
    expect(states.at(-1)).toBe('stopped')
    vi.advanceTimersByTime(120_000)
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('start twice opens one socket, and an error then close retries once', () => {
    const { socket } = client()
    socket.start()
    socket.start()
    expect(FakeSocket.all).toHaveLength(1)
    FakeSocket.all[0]!.emit('error')
    FakeSocket.all[0]!.drop()
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('a throwing onState does not stop the retry', () => {
    const socket = createLiveSocket({
      url: 'wss://example.test/live',
      onFrame: () => {},
      onState: () => {
        throw new Error('boom')
      },
      WebSocket: FakeSocket,
      random: () => 0.5,
      now: () => clock,
    })
    socket.start()
    FakeSocket.all[0]!.drop()
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('a send that throws replaces the socket', () => {
    const { socket } = client()
    socket.start()
    const fake = FakeSocket.all[0]!
    fake.send = () => {
      throw new Error('gone')
    }
    fake.open()
    clock = 30_000
    vi.advanceTimersByTime(30_000)
    expect(fake.closed).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('stop closes the socket and never reconnects', () => {
    const { socket, states } = client()
    socket.start()
    FakeSocket.all[0]!.open()
    socket.stop()
    expect(FakeSocket.all[0]!.closed).toBe(true)
    expect(states.at(-1)).toBe('stopped')
    vi.advanceTimersByTime(120_000)
    expect(FakeSocket.all).toHaveLength(1)
    socket.start()
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('a constructor that throws is retried, and a missing WebSocket stays closed', () => {
    let calls = 0
    class Throwing extends FakeSocket {
      constructor(url: string) {
        calls += 1
        if (calls === 1) throw new Error('bad url')
        super(url)
      }
    }
    const { socket } = client({ WebSocket: Throwing })
    socket.start()
    expect(socket.state()).toBe('closed')
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(1)

    const none = createLiveSocket({ url: 'wss://x', onFrame: () => {}, WebSocket: undefined })
    const original = (globalThis as { WebSocket?: unknown }).WebSocket
    ;(globalThis as { WebSocket?: unknown }).WebSocket = undefined
    try {
      const bare = createLiveSocket({ url: 'wss://x', onFrame: () => {} })
      bare.start()
      expect(bare.state()).toBe('closed')
    } finally {
      ;(globalThis as { WebSocket?: unknown }).WebSocket = original
    }
    expect(none.state()).toBe('stopped')
  })

  it('reads a function url on every connect', () => {
    let n = 0
    const { socket } = client({ url: () => `wss://example.test/live?n=${++n}` })
    socket.start()
    FakeSocket.all[0]!.drop()
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all.map((s) => s.url)).toEqual([
      'wss://example.test/live?n=1',
      'wss://example.test/live?n=2',
    ])
  })
})
