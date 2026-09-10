/**
 * Fail when the tracked `dist/` does not match what `src/` compiles to.
 *
 * This package's `dist/` is committed (since #178) so that a git-dependency
 * consumer can resolve its exports without a build step. That only works while
 * the committed output is the current one: a refactor that changes an emitted
 * `.d.ts` and is pushed without a rebuild hands that consumer type errors on
 * exports the source clearly declares.
 *
 * `prebuild` removes `dist/` and `build` re-emits it, so running this
 * immediately afterwards compares a fresh compile against the committed tree:
 * any difference, including a file git does not know about yet, is staleness.
 * Same mechanism as narduk-mapkit's `script/check_dist_clean.mjs`, which is the
 * other package here that tracks its build output.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'dist'], {
  cwd: packageRoot,
  encoding: 'utf8',
})

if (result.error || result.status !== 0) {
  process.stderr.write(
    result.stderr || `${result.error?.message ?? 'Unable to inspect the committed dist output.'}\n`,
  )
  process.exit(result.status ?? 1)
}

if (result.stdout.trim()) {
  process.stderr.write('narduk-realtime dist/ is stale relative to src/:\n')
  process.stderr.write(result.stdout)
  process.stderr.write(
    'Run pnpm run build in this package and commit the resulting dist/ changes.\n',
  )
  process.exit(1)
}

console.log('narduk-realtime dist/ matches the committed build output.')
