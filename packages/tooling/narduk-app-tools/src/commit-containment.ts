import { spawnSync } from 'node:child_process'

/**
 * Whether `candidate` already contains everything `served` changed, so that
 * publishing `candidate` cannot silently undo what production serves.
 *
 * Ancestry answers it for merges and fast-forwards. A squash or rebase merge
 * rewrites the commit, so the fallback asks git directly: merging `served` into
 * `candidate` is clean and changes nothing. That holds for every way a change
 * lands on the production branch, without guessing at patch ids.
 *
 * `unknown` means git could not answer -- a commit object is missing, or git
 * failed -- and callers refuse on it rather than guess.
 */
export type Containment = 'contained' | 'not-contained' | 'unknown'

type Git = (args: string[]) => { status: number | null; stdout: string }

function defaultGit(cwd: string): Git {
  return (args) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: result.error ? null : result.status, stdout: result.stdout?.trim() ?? '' }
  }
}

export function commitContains(
  cwd: string,
  candidate: string,
  served: string,
  git: Git = defaultGit(cwd),
): Containment {
  for (const sha of [candidate, served]) {
    if (git(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) return 'unknown'
  }
  const ancestor = git(['merge-base', '--is-ancestor', served, candidate]).status
  if (ancestor === 0) return 'contained'
  if (ancestor !== 1) return 'unknown'
  const merged = git(['merge-tree', '--write-tree', candidate, served])
  // Exit 1 is a conflicted merge: `served` has changes `candidate` lacks.
  if (merged.status === 1) return 'not-contained'
  if (merged.status !== 0) return 'unknown'
  const tree = git(['rev-parse', `${candidate}^{tree}`])
  if (tree.status !== 0) return 'unknown'
  return merged.stdout.split('\n')[0] === tree.stdout ? 'contained' : 'not-contained'
}

/**
 * Makes both commits readable in a shallow CI checkout: a blobless unshallow
 * fetch, only when an object is missing. Returns whether both now exist.
 */
export function ensureCommits(cwd: string, shas: string[], git: Git = defaultGit(cwd)): boolean {
  const missing = () => shas.some((sha) => git(['cat-file', '-e', `${sha}^{commit}`]).status !== 0)
  if (!missing()) return true
  const shallow = git(['rev-parse', '--is-shallow-repository']).stdout === 'true'
  git([
    'fetch',
    '--quiet',
    '--no-tags',
    '--filter=blob:none',
    ...(shallow ? ['--unshallow'] : []),
    'origin',
    ...shas,
  ])
  return !missing()
}
