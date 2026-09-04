import { spawnSync } from 'node:child_process'

const result = spawnSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all', '--', 'dist'],
  { encoding: 'utf8' },
)

if (result.status !== 0) {
  process.stderr.write(result.stderr || 'Unable to inspect committed dist output.\n')
  process.exit(result.status ?? 1)
}

if (result.stdout.trim()) {
  process.stderr.write('Core dist/ is stale or contains uncommitted generated files:\n')
  process.stderr.write(result.stdout)
  process.stderr.write('Run pnpm run build and commit the resulting dist/ changes.\n')
  process.exit(1)
}

console.log('Core dist/ matches the committed build output.')
