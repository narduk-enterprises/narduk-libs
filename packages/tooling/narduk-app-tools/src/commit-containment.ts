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

function exec(command: string, cwd: string): Exec {
  return (args) => {
    const result = spawnSync(command, args, {
      cwd,
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

/** One GitHub REST GET: the parsed JSON, or null when it could not answer. */
export type GitHubGet = (path: string) => unknown

/**
 * With GH_TOKEN or GITHUB_TOKEN in the environment (a promote step passes
 * `github.token`), curl reads the auth header from stdin, so the token never
 * reaches argv or `ps`; runners carry curl but not `gh`. Without one, a
 * workstation's `gh api` login answers.
 */
export function githubGet(cwd: string, env: NodeJS.ProcessEnv = process.env): GitHubGet {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN
  const repo = githubRepo(cwd, env)
  return (path) => {
    if (!repo) return null
    const url = `https://api.github.com/repos/${repo}/${path}`
    const options = {
      cwd,
      encoding: 'utf8' as const,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    }
    const result = token
      ? spawnSync('curl', ['-sS', '--fail', '--max-time', '30', '-K', '-', url], {
          ...options,
          input: `header = "Authorization: Bearer ${token}"\nheader = "Accept: application/vnd.github+json"\n`,
        })
      : spawnSync('gh', ['api', `repos/${repo}/${path}`], { ...options, stdio: 'pipe' })
    if (result.error || result.status !== 0) return null
    try {
      return JSON.parse(result.stdout) as unknown
    } catch {
      return null
    }
  }
}

function githubRepo(cwd: string, env: NodeJS.ProcessEnv): string | undefined {
  const named = env.GH_REPO || env.GITHUB_REPOSITORY
  if (named) return named
  const origin = exec('git', cwd)(['remote', 'get-url', 'origin'])
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/u.exec(origin.stdout)?.[1]
}

/**
 * GitHub's answer, for a shallow CI checkout that lacks the objects: `served`
 * is an ancestor of `candidate`, or a merged pull request carrying `served`
 * landed in `candidate`'s history. The second is what a ship means by "main
 * has it": the PR's final state, review fixes included, supersedes the
 * shipped commit even when a squash rewrote the lines it touched.
 */
export function landedContains(candidate: string, served: string, get: GitHubGet): Containment {
  const ahead = (base: string): boolean | null => {
    const status = (get(`compare/${base}...${candidate}?per_page=1`) as { status?: unknown } | null)
      ?.status
    if (typeof status !== 'string') return null
    return status === 'ahead' || status === 'identical'
  }
  const direct = ahead(served)
  if (direct) return 'contained'
  const pulls = get(`commits/${served}/pulls`)
  if (!Array.isArray(pulls)) return 'unknown'
  for (const pull of pulls as { merged_at?: unknown; merge_commit_sha?: unknown }[]) {
    if (!pull.merged_at || typeof pull.merge_commit_sha !== 'string') continue
    if (!/^[a-f\d]{40}$/u.test(pull.merge_commit_sha)) continue
    const landed = ahead(pull.merge_commit_sha)
    if (landed === null) return 'unknown'
    if (landed) return 'contained'
  }
  return direct === null ? 'unknown' : 'not-contained'
}

/** Local git first, then GitHub. */
export function resolveContainment(
  cwd: string,
  candidate: string,
  served: string,
  options: { git?: Exec; github?: GitHubGet; env?: NodeJS.ProcessEnv } = {},
): Containment {
  const local = commitContains(cwd, candidate, served, options.git)
  if (local === 'contained') return local
  const landed = landedContains(
    candidate,
    served,
    options.github ?? githubGet(cwd, options.env ?? process.env),
  )
  if (landed === 'contained') return landed
  return local === 'not-contained' || landed === 'not-contained' ? 'not-contained' : 'unknown'
}
