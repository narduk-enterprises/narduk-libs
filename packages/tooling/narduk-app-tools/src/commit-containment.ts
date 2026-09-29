import { spawnSync } from 'node:child_process'

/**
 * Whether `candidate` already contains everything `served` changed, so that
 * publishing `candidate` cannot silently undo what production serves.
 *
 * `unknown` means neither git nor GitHub could answer, and callers refuse on
 * it rather than guess.
 */
export type Containment = 'contained' | 'not-contained' | 'unknown'

type Exec = (args: string[]) => { status: number | null; stdout: string }

function exec(command: string, cwd: string, env?: NodeJS.ProcessEnv): Exec {
  return (args) => {
    const result = spawnSync(command, args, {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: result.error ? null : result.status, stdout: result.stdout?.trim() ?? '' }
  }
}

/**
 * Local git, from objects already in the checkout; it never fetches.
 *
 * Ancestry answers it for merges and fast-forwards. A squash or rebase merge
 * rewrites the commit, so the fallback asks git directly: merging `served` into
 * `candidate` is clean and changes nothing.
 */
export function commitContains(
  cwd: string,
  candidate: string,
  served: string,
  git: Exec = exec('git', cwd),
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
 * GitHub's answer, for a shallow CI checkout that lacks the objects: `served`
 * is an ancestor of `candidate`, or a merged pull request carrying `served`
 * landed in `candidate`'s history. The second is what a ship means by "main
 * has it": the PR's final state, review fixes included, supersedes the
 * shipped commit even when a squash rewrote the lines it touched.
 */
export function landedContains(candidate: string, served: string, gh: Exec): Containment {
  const ahead = (base: string): boolean | null => {
    const result = gh([
      'api',
      `repos/{owner}/{repo}/compare/${base}...${candidate}?per_page=1`,
      '--jq',
      '.status',
    ])
    if (result.status !== 0) return null
    return result.stdout === 'ahead' || result.stdout === 'identical'
  }
  const direct = ahead(served)
  if (direct) return 'contained'
  const pulls = gh([
    'api',
    `repos/{owner}/{repo}/commits/${served}/pulls`,
    '--jq',
    '.[] | select(.merged_at != null) | .merge_commit_sha',
  ])
  if (pulls.status !== 0) return 'unknown'
  for (const merge of pulls.stdout.split('\n').filter((line) => /^[a-f\d]{40}$/u.test(line))) {
    const landed = ahead(merge)
    if (landed === null) return 'unknown'
    if (landed) return 'contained'
  }
  return direct === null ? 'unknown' : 'not-contained'
}

/**
 * Local git first, then GitHub. `gh` reads GH_TOKEN or GITHUB_TOKEN (a promote
 * workflow passes `github.token`) or a workstation login, and resolves the
 * repository from GH_REPO, GITHUB_REPOSITORY or the checkout's origin.
 */
export function resolveContainment(
  cwd: string,
  candidate: string,
  served: string,
  options: { git?: Exec; gh?: Exec; env?: NodeJS.ProcessEnv } = {},
): Containment {
  const local = commitContains(cwd, candidate, served, options.git)
  if (local === 'contained') return local
  const env = options.env ?? process.env
  const repo = env.GH_REPO || env.GITHUB_REPOSITORY
  const landed = landedContains(
    candidate,
    served,
    options.gh ?? exec('gh', cwd, repo ? { ...env, GH_REPO: repo } : env),
  )
  if (landed === 'contained') return landed
  return local === 'not-contained' || landed === 'not-contained' ? 'not-contained' : 'unknown'
}
