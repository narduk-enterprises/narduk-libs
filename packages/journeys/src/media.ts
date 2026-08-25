import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

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
