import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import type { CaptureEncode } from './types.js'

export const DEFAULT_CAPTURE_ENCODE = { preset: 'medium', crf: 23 } as const

/**
 * The ffmpeg argv both adapters use so a published capture is one encode
 * decision (narduk-libs#115). libx264, yuv420p, `+faststart`, no audio —
 * the web path's existing normalisation, plus the profile's preset / crf /
 * optional long-edge scale.
 */
export function normaliseVideoArgs(
  input: string,
  output: string,
  target: CaptureEncode = {},
): string[] {
  const preset = target.preset ?? DEFAULT_CAPTURE_ENCODE.preset
  const crf = target.crf ?? DEFAULT_CAPTURE_ENCODE.crf
  const args = [
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
  ]
  if (target.maxLongEdge !== undefined) {
    const edge = target.maxLongEdge
    args.push(
      '-vf',
      `scale=${String(edge)}:${String(edge)}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    )
  }
  args.push(output)
  return args
}

/** Re-encode `input` to `output`. Returns false when ffmpeg is missing or fails. */
export function normaliseVideo(input: string, output: string, target: CaptureEncode = {}): boolean {
  const result = spawnSync('ffmpeg', normaliseVideoArgs(input, output, target))
  return result.status === 0 && existsSync(output)
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
  const seconds = Number.parseFloat((result.stdout || '').trim())
  return Number.isFinite(seconds) ? seconds : null
}
