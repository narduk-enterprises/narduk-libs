import { describe, expect, it } from 'vitest'
import { RequestTiming } from '../src/timing.js'

function clockFrom(...ticks: number[]): () => number {
  const queue = [...ticks]
  return () => queue.shift() ?? queue[queue.length - 1] ?? 0
}

describe('RequestTiming', () => {
  it('emits only total by default, hiding phase names and descriptions', () => {
    const timing = new RequestTiming({ clock: clockFrom(0, 10, 40, 305) })
    timing.mark('auth')
    timing.mark('board', '18 stmt / 11 rt')
    expect(timing.header()).toBe('total;dur=305')
  })

  it('exposes named phases and sanitized descriptions when opted in', () => {
    const timing = new RequestTiming({
      exposePhases: true,
      clock: clockFrom(0, 0, 17, 31, 305),
    })
    timing.mark('auth')
    timing.mark('scope', '1 stmt / 1 rt')
    timing.mark('board', '18 stmt / 11 rt')
    expect(timing.header()).toBe(
      'auth;dur=0, scope;dur=17;desc="1 stmt / 1 rt", board;dur=14;desc="18 stmt / 11 rt", total;dur=305',
    )
  })

  it('strips quotes, backslashes, commas, and control characters from a description', () => {
    const timing = new RequestTiming({ exposePhases: true, clock: clockFrom(0, 5, 5) })
    timing.mark('board', 'ok",\\evil desc')
    expect(timing.header()).toBe('board;dur=5;desc="okevil desc", total;dur=5')
  })

  it('truncates an overlong description', () => {
    const timing = new RequestTiming({ exposePhases: true, clock: clockFrom(0, 1, 1) })
    timing.mark('board', 'x'.repeat(500))
    const rendered = timing.header()
    const match = /desc="(x+)"/.exec(rendered)
    expect(match?.[1]).toHaveLength(128)
  })

  it('rejects a phase name outside the safe token charset', () => {
    const timing = new RequestTiming()
    expect(() => timing.mark('bad name;dur=1')).toThrow(TypeError)
    expect(() => timing.mark('')).toThrow(TypeError)
  })

  it('bounds the number of rendered phases without losing elapsed time from total', () => {
    const ticks = Array.from({ length: 40 }, (_, index) => index)
    const timing = new RequestTiming({ exposePhases: true, clock: clockFrom(...ticks, 39) })
    for (let index = 0; index < 40; index++) timing.mark(`phase${index}`)
    const rendered = timing.header()
    const phaseEntries = rendered.split(', ').filter((part) => !part.startsWith('total'))
    expect(phaseEntries.length).toBeLessThanOrEqual(32)
    expect(rendered).toMatch(/total;dur=\d+$/)
  })

  it('never reports a negative duration across a clock that moves backward', () => {
    const timing = new RequestTiming({ clock: clockFrom(100, 40) })
    expect(timing.totalMs()).toBe(0)
  })

  it('measure() marks the phase after the callback settles, on success and failure', async () => {
    const timing = new RequestTiming({ exposePhases: true, clock: clockFrom(0, 12, 12) })
    const result = await timing.measure('fetch', async () => 'ok')
    expect(result).toBe('ok')
    expect(timing.header()).toContain('fetch;dur=12')

    const failing = new RequestTiming({ exposePhases: true, clock: clockFrom(0, 8, 8) })
    await expect(
      failing.measure('fetch', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(failing.header()).toContain('fetch;dur=8')
  })

  it('anchors total to a supplied start rather than construction time', () => {
    const timing = new RequestTiming({ start: 100, clock: clockFrom(150) })
    expect(timing.totalMs()).toBe(50)
  })
})
