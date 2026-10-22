import { spawnSync } from 'node:child_process'

/**
 * `--base` names the ref this run compares against, so it is the ref worth
 * refreshing -- fetching `origin/main` while comparing against something else
 * is the stale-base failure (#492) with an extra network call in front of it.
 * `origin/main` splits into remote `origin` and ref `main`; a bare branch
 * name, a SHA, or `HEAD~3` names no remote and is left alone rather than
 * guessed at, since a wrong guess fetches the wrong thing silently.
 */
export function fetchTargetForBase(base, remotes) {
  const separator = base.indexOf('/')
  if (separator <= 0) return undefined
  const remote = base.slice(0, separator)
  const ref = base.slice(separator + 1)
  if (!ref || !remotes.includes(remote)) return undefined
  return { remote, ref }
}

// Refresh only a named remote branch, never a local/historical comparison.
// Ignore Git's output: a credential helper's diagnostics must not reach this gate.
export function refreshComparisonBase(root, base, { run = spawnSync, timeout = 30_000 } = {}) {
  const resolved = run(
    'git',
    ['rev-parse', '--symbolic-full-name', '--verify', '--end-of-options', base],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    },
  )
  if (resolved.error) throw new Error('Cannot resolve comparison base; freshness is unknown.')
  // Computed revisions have no symbolic name. Invalid refs retain the caller's
  // existing merge-base diagnostic; neither is a branch to fetch.
  if (resolved.status !== 0 || !resolved.stdout.trim().startsWith('refs/remotes/')) return undefined
  const remoteBase = resolved.stdout.trim().slice('refs/remotes/'.length)
  const remotes = run('git', ['remote'], { cwd: root, encoding: 'utf8', timeout: 10_000 })
  if (remotes.error || remotes.status !== 0) {
    throw new Error('Cannot discover comparison-base remotes; freshness is unknown.')
  }
  const target = fetchTargetForBase(remoteBase, remotes.stdout.trim().split(/\r?\n/u))
  if (!target) throw new Error('Comparison base has no configured remote; freshness is unknown.')
  const result = run(
    'git',
    [
      'fetch',
      '--no-tags',
      '--no-recurse-submodules',
      target.remote,
      `refs/heads/${target.ref}:refs/remotes/${remoteBase}`,
    ],
    {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      timeout,
      killSignal: 'SIGKILL',
    },
  )
  if (result.error || result.status !== 0) {
    if (result.pid) {
      try {
        process.kill(-result.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH')
          throw new Error('Comparison-base fetch failed; child cleanup is unconfirmed.')
      }
    }
    const reason = result.error?.code === 'ETIMEDOUT' ? 'timed out' : 'failed'
    throw new Error(
      `Refreshing comparison base '${base}' ${reason}; freshness is unknown. Fetch that remote branch and rerun. No release verdict was produced.`,
    )
  }
  return `Refreshed comparison base '${base}' from its remote.`
}
