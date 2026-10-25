import { spawnSync } from 'node:child_process'

// The package comparison uses commits; a local working tree is not its head.
// Inspect names/status only, and keep paths out of the diagnostic.
export function ignoredWorktreeWarning(root, head = 'HEAD') {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (result.error || result.status !== 0) {
    return `Warning: release-plan:check could not inspect local worktree changes (git status failed). Its changed-package comparison uses committed ${JSON.stringify(head)}; coverage of local changes is unknown. Commit your changes and rerun before relying on CI parity.`
  }
  if (!result.stdout) return undefined
  return `Warning: release-plan:check compares committed ${JSON.stringify(head)}; uncommitted or untracked worktree changes are excluded from its changed-package comparison. Commit your changes and rerun before relying on CI parity.`
}
