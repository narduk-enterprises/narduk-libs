import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createEncodeLane, encodeVideo, encodeVideoArgs } from '../src/media.js'

describe('encodeVideoArgs', () => {
  it('honours a declared preset and crf instead of a hardcoded medium encode', () => {
    const args = encodeVideoArgs('in.webm', 'out.mp4', { preset: 'veryfast', crf: 28 })
    expect(args).toContain('-preset')
    expect(args).toContain('veryfast')
    expect(args).toContain('-crf')
    expect(args).toContain('28')
    expect(args).toContain('+faststart')
    expect(args).not.toContain('medium')
  })
})

describe('encodeVideo', () => {
  it('is async so a missing ffmpeg is reported instead of blocking spawnSync', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'njr-encode-'))
    const input = join(dir, 'in.webm')
    writeFileSync(input, 'not-a-video')
    const started = Date.now()
    let ticks = 0
    const ticker = setInterval(() => {
      ticks += 1
    }, 5)
    const result = await encodeVideo(input, join(dir, 'out.mp4'), { preset: 'veryfast' })
    clearInterval(ticker)
    expect(result.ok).toBe(false)
    expect(result.ffmpeg === 'missing' || result.ffmpeg === 'failed').toBe(true)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(ticks).toBeGreaterThan(0)
  })
})

describe('createEncodeLane', () => {
  it('runs one encode at a time so two jobs never overlap', async () => {
    const lane = createEncodeLane()
    const log: string[] = []
    const first = lane.enqueue(async () => {
      log.push('first-start')
      await new Promise((resolve) => setTimeout(resolve, 30))
      log.push('first-end')
      return 1
    })
    const second = lane.enqueue(async () => {
      log.push('second-start')
      return 2
    })
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
    expect(log).toEqual(['first-start', 'first-end', 'second-start'])
  })
})
