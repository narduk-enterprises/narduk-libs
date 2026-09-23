import { describe, expect, it } from 'vitest'

import {
  BoundedBodyTooLargeError,
  readBoundedBody,
  readBoundedJson,
} from '../runtime/server/utils/boundedBody'

function streamed(chunks: string[], headers: Record<string, string> = {}) {
  const encoder = new TextEncoder()
  let sent = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const next = chunks[sent++]
        if (next === undefined) controller.close()
        else controller.enqueue(encoder.encode(next))
      },
      cancel() {
        cancelled = true
      },
      // Pull only when read, so `sent` counts what the reader asked for.
    },
    { highWaterMark: 0 },
  )
  return {
    response: new Response(body, { headers }),
    sent: () => sent,
    cancelled: () => cancelled,
  }
}

describe('readBoundedBody (narduk-libs#565)', () => {
  it('returns a body under the ceiling', async () => {
    const { response } = streamed(['ab', 'cd'])
    expect(new TextDecoder().decode(await readBoundedBody(response, 4))).toBe('abcd')
  })

  it('refuses a declared length over the ceiling before reading', async () => {
    const { response, sent } = streamed(['ab'], { 'content-length': '10' })
    await expect(readBoundedBody(response, 4, { label: 'GitHub' })).rejects.toThrow(
      'GitHub exceeds the 4-byte ceiling.',
    )
    expect(sent()).toBe(0)
  })

  it('cancels a stream at the ceiling instead of draining it', async () => {
    const { response, sent, cancelled } = streamed(['abc', 'def', 'ghi', 'jkl'])
    const error = await readBoundedBody(response, 4).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BoundedBodyTooLargeError)
    expect((error as BoundedBodyTooLargeError).maxBytes).toBe(4)
    expect(cancelled()).toBe(true)
    expect(sent()).toBeLessThan(4)
  })

  it('throws the caller’s own error when given one', async () => {
    const { response } = streamed(['abcdef'])
    await expect(
      readBoundedBody(response, 4, { tooLarge: () => new RangeError('mine') }),
    ).rejects.toThrow(RangeError)
  })

  it('parses JSON through the same ceiling', async () => {
    await expect(readBoundedJson(streamed(['{"a":', '1}']).response, 64)).resolves.toEqual({ a: 1 })
    await expect(readBoundedJson(streamed(['{"a":', '1}']).response, 4)).rejects.toBeInstanceOf(
      BoundedBodyTooLargeError,
    )
  })
})
