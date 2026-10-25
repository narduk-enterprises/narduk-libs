import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiveSocket, type LiveSocketLike } from '../src/client/live-socket.js'

type Listener = (event: { data: unknown }) => void

class FakeSocket implements LiveSocketLike {
  static all: FakeSocket[] = []
  listeners = new Map<string, Listener[]>()
  readyState = 0
  closed = false
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: undefined })
  }
  send() {}
  close() {
    this.closed = true
    this.readyState = 3
  }
}

beforeEach(() => {
  FakeSocket.all = []
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function make(onState: (state: string, self: ReturnType<typeof createLiveSocket>) => void) {
  const holder: { socket?: ReturnType<typeof createLiveSocket> } = {}
  holder.socket = createLiveSocket({
    url: 'wss://example.test/live',
    onFrame: () => {},
    onState: (state) => onState(state, holder.socket!),
    WebSocket: FakeSocket,
    random: () => 0.5,
    connectTimeoutMs: 15_000,
  })
  return holder.socket
}

describe('createLiveSocket re-entrant onState (ponytail-5 #16)', () => {
  it('leaves no ping interval when onState("open") stops the client', () => {
    const socket = make((state, self) => {
      if (state === 'open') self.stop()
    })
    socket.start()
    FakeSocket.all[0]!.readyState = 1
    FakeSocket.all[0]!.emit('open')
    expect(socket.state()).toBe('stopped')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a reconnect started from onState("closed") past the old connect timeout', () => {
    let restarted = false
    const socket = make((state, self) => {
      if (state === 'closed' && !restarted) {
        restarted = true
        self.stop()
        self.start()
      }
    })
    socket.start()
    FakeSocket.all[0]!.emit('close')
    const second = FakeSocket.all[1]!
    expect(second).toBeDefined()
    // Only the restart's own connect timeout is pending, not a second, orphaned one.
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(14_000)
    expect(second.closed).toBe(false)
  })
})
