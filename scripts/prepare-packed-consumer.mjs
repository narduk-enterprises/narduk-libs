import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadWorkspace } from './compute-affected-packages.mjs'
import { runConsumerCommand } from './consumer-smoke-command.mjs'
import { mapPackages } from './consumer-smoke-phases.mjs'

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

export async function preparePackedConsumer({
  root,
  cacheDirectory,
  concurrency = 2,
  installBrowser,
  run,
}) {
  const tasks = [
    {
      label: 'Build coordinated release set',
      args: packedConsumerBuildArgs(loadWorkspace(root).packages, cacheDirectory, concurrency),
    },
    ...(installBrowser
      ? [
          {
            label: 'Install Chromium and Linux browser dependencies',
            args: ['exec', 'playwright', 'install', '--with-deps', 'chromium'],
          },
        ]
      : []),
  ]
  // Browser downloads/apt and package compilation are independent. Drain both
  // on failure so no background installer or build outlives this preparation.
  await mapPackages(tasks, async ({ label, args }) => {
    const started = performance.now()
    process.stdout.write(`[consumer-smoke] ${label}\n`)
    await run('pnpm', args, { cwd: root, env: process.env })
    process.stdout.write(
      `[consumer-smoke] Completed ${label} in ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
    )
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'install-browser': { type: 'boolean', default: false },
      'build-concurrency': { type: 'string', default: '2' },
    },
  })
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  await preparePackedConsumer({
    root,
    cacheDirectory: process.env.TURBO_CACHE_DIR || join(root, '.turbo', 'cache'),
    concurrency: Number(values['build-concurrency']),
    installBrowser: values['install-browser'],
    run: runConsumerCommand,
  })
}
