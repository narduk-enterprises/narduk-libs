import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

import type { CaptureVideoEncode } from './types.js'

export const DEFAULT_CAPTURE_ENCODE = { preset: 'medium', crf: 23 } as const

export type EncodeToolStatus = 'ok' | 'missing' | 'failed'

export interface EncodeVideoResult {
  ok: boolean
  ffmpeg: EncodeToolStatus
  probe: EncodeToolStatus
  seconds: number | null
  maxBytesExceeded?: boolean
}

/**
 * The ffmpeg argv the web adapter used to hardcode. Preset and CRF are
 * declarable so a consumer can trade encode seconds against bytes
 * (narduk-libs#114).
 */
export function encodeVideoArgs(
  input: string,
  output: string,
  target: CaptureVideoEncode = {},
): string[] {
  const preset = target.preset ?? DEFAULT_CAPTURE_ENCODE.preset
  const crf = target.crf ?? DEFAULT_CAPTURE_ENCODE.crf
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    output,
  ]
}

/**
 * Re-encode with `spawn`, not `spawnSync`, so the Playwright worker's event
 * loop stays free for the next journey's world reset and page load.
 */
export function encodeVideo(
  input: string,
  output: string,
  target: CaptureVideoEncode = {},
): Promise<EncodeVideoResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: EncodeVideoResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn('ffmpeg', encodeVideoArgs(input, output, target), {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    child.on('error', (error) => {
      finish({
        ok: false,
        ffmpeg: isMissingTool(error) ? 'missing' : 'failed',
        ...probeVideo(existsSync(output) ? output : input),
      })
    })
    child.on('close', (status) => {
      const ok = status === 0 && existsSync(output)
      const probed = probeVideo(ok ? output : input)
      const maxBytesExceeded =
        ok && target.maxBytes !== undefined && statSync(output).size > target.maxBytes
      finish({
        ok,
        ffmpeg: ok ? 'ok' : 'failed',
        ...probed,
        ...(maxBytesExceeded ? { maxBytesExceeded: true } : {}),
      })
    })
  })
}

/** One encode in flight at a time — overlapping a live browser is the flake shape. */
export function createEncodeLane(): {
  enqueue<T>(work: () => Promise<T>): Promise<T>
  idle(): Promise<void>
} {
  let tail: Promise<void> = Promise.resolve()
  return {
    enqueue<T>(work: () => Promise<T>): Promise<T> {
      const run = tail.then(work, work)
      tail = settle(run)
      return run
    },
    idle() {
      return settle(tail)
    },
  }
}

async function settle(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch {
    // A failed encode must not stall the next one.
  }
}

/** Hash one artefact file, in the `sha256:` form every manifest field uses. */
export function sha256File(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

/**
 * A recording's duration, or null when ffprobe is absent or cannot read the
 * container. Null is recorded honestly rather than guessed: the manifest's
 * `video.seconds` is nullable for exactly this case.
 */
export function videoSeconds(path: string): number | null {
  return probeVideo(path).seconds
}

export function probeVideo(path: string): { seconds: number | null; probe: EncodeToolStatus } {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ],
    { encoding: 'utf8' },
  )
  if (result.error && isMissingTool(result.error)) {
    return { seconds: null, probe: 'missing' }
  }
  const seconds = Number.parseFloat((result.stdout || '').trim())
  if (Number.isFinite(seconds)) return { seconds, probe: 'ok' }
  return { seconds: null, probe: 'failed' }
}

function isMissingTool(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
