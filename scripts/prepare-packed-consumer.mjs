import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadWorkspace } from './compute-affected-packages.mjs'
import { runConsumerCommand } from './consumer-smoke-command.mjs'
import { parsePackagesArgument, selectScopedPackages } from './packed-consumer-scope.mjs'

// Match release-packages.mjs's publication boundary. Turbo includes each
// package's dependencies, including private build tools if one is required.
//
// `scope`, when given, must be the planner's `consumerScope` and must match the
// scope release-packages.mjs is given for the same run: this builds what that
// packs. Omitted, both build and pack every publishable package, which is what
// a release and every push to main do.
export function packedConsumerBuildArgs(packages, cacheDirectory, concurrency = 2, scope) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
    throw new Error('Build concurrency must be an integer from 1 to 4.')
  const publishable = packages.filter(({ manifest }) => manifest.private !== true)
  if (publishable.length === 0) throw new Error('No publishable packages found.')
  const published = scope ? selectScopedPackages(publishable, scope) : publishable
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
      packages: { type: 'string', multiple: true },
    },
  })
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const scope = parsePackagesArgument(process.argv.slice(2))
  const args = packedConsumerBuildArgs(
    loadWorkspace(root).packages,
    process.env.TURBO_CACHE_DIR || join(root, '.turbo', 'cache'),
    Number(values['build-concurrency']),
    scope,
  )
  if (scope)
    console.log(`[packed-consumer] Building a scope of ${scope.length}: ${scope.join(', ')}`)
  await runConsumerCommand('pnpm', args, { cwd: root, env: process.env })
}
