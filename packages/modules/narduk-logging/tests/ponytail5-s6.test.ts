import { describe, expect, it } from 'vitest'

import { createBoundedBuffer } from '../src/buffer.js'

describe('ponytail-5 s6 logging', () => {
  it('#17 a second flush resolves only after a record queued during the first is sent', async () => {
    const sent: number[][] = []
    let release: (() => void) | undefined
    const buffer = createBoundedBuffer<number>({
      size: () => 10,
      send: (batch) =>
        new Promise<void>((resolve) => {
          sent.push([...batch])
          if (sent.length === 1) release = resolve
          else resolve()
        }),
    })
    buffer.push(1)
    void buffer.flush()
    await Promise.resolve()
    buffer.push(2)
    const second = buffer.flush()
    release?.()
    await second
    expect(sent.flat()).toEqual([1, 2])
  })
})
