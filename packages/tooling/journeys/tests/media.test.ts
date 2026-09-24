import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { DEFAULT_CAPTURE_ENCODE, normaliseVideo, normaliseVideoArgs } from '../src/media.js'

describe('normaliseVideoArgs', () => {
  it('matches the web path: libx264, yuv420p, +faststart, no audio', () => {
    const args = normaliseVideoArgs('in.webm', 'out.mp4')
    expect(args).toEqual([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'in.webm',
      '-c:v',
      'libx264',
      '-preset',
      DEFAULT_CAPTURE_ENCODE.preset,
      '-crf',
      String(DEFAULT_CAPTURE_ENCODE.crf),
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      'out.mp4',
    ])
  })

  it('scales to a declared long edge', () => {
    const args = normaliseVideoArgs('in.mp4', 'out.mp4', {
      preset: 'veryfast',
      crf: 28,
      maxLongEdge: 1080,
    })
    expect(args).toContain('veryfast')
    expect(args).toContain('28')
    expect(args).toContain(
      'scale=1080:1080:force_original_aspect_ratio=decrease:force_divisible_by=2',
    )
  })
})

describe('normaliseVideo', () => {
  it('writes a smaller, seekable mp4 than a Retina-sized source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'njr-encode-'))
    const input = join(dir, 'raw.mp4')
    const output = join(dir, 'out.mp4')
    const generated = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=1178x2556:d=1',
        '-frames:v',
        '8',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        input,
      ],
      { encoding: 'utf8' },
    )
    expect(generated.status, generated.stderr).toBe(0)
    expect(normaliseVideo(input, output, { maxLongEdge: 1080, crf: 28, preset: 'veryfast' })).toBe(
      true,
    )
    expect(statSync(output).size).toBeLessThan(statSync(input).size)
    const bytes = readFileSync(output)
    const moov = bytes.indexOf(Buffer.from('moov'))
    const mdat = bytes.indexOf(Buffer.from('mdat'))
    expect(moov).toBeGreaterThan(-1)
    expect(moov).toBeLessThan(mdat)
  })
})
