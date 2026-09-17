import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadWorkspace } from './compute-affected-packages.mjs'
import { runConsumerCommand } from './consumer-smoke-command.mjs'

// Match release-packages.mjs's publication boundary. Turbo includes each
// package's dependencies, including private build tools if one is required.
export function packedConsumerBuildArgs(packages, cacheDirectory, concurrency = 2) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error('Build concurrency must be an integer from 1 to 4.')
  const published = packages.filter(({ manifest }) => manifest.private !== true)
  if (published.length === 0) throw new Error('No publishable packages found.')
  return [
    'exec',
    'turbo',
    'run',
    'build',
    ...published.map(({ manifest }) => `--filter=${manifest.name}...`),
    `--concurrency=${concurrency}`,
    `--cache-dir=${cacheDirectory}`,
    '--cache-workers=4',
  ]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'build-concurrency': { type: 'string', default: '2' },
    },
  })
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const args = packedConsumerBuildArgs(
    loadWorkspace(root).packages,
    process.env.TURBO_CACHE_DIR || join(root, '.turbo', 'cache'),
    Number(values['build-concurrency']),
  )
  await runConsumerCommand('pnpm', args, { cwd: root, env: process.env })
}
