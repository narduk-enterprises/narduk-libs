import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'
import { consumerSmokeGeneratorArgs } from './consumer-smoke-fixture.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generator = loadWorkspace(root).byName.get('@narduk-enterprises/create-narduk-app')
const { DEPENDABOT_COOLDOWN_DAYS } = await import(
  pathToFileURL(join(generator.directory, 'dist/dependency-policy.js')).href
)
const directory = await mkdtemp(join(tmpdir(), 'narduk-generator-pins-'))
const app = join(directory, 'app')

function run(command, args, cwd = app) {
  const started = performance.now()
  process.stdout.write(`\n[generator-pin-smoke] ${command} ${args.join(' ')}\n`)
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    timeout: 10 * 60_000,
    env: { ...process.env, CI: 'true', NUXT_TELEMETRY_DISABLED: '1' },
  })
  process.stdout.write(
    `[generator-pin-smoke] Passed in ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
  )
}

try {
  run(
    process.execPath,
    [join(generator.directory, 'dist/cli.js'), ...consumerSmokeGeneratorArgs(app).slice(2)],
    root,
  )
  // The existing release smoke disables only unused remote font catalogs.
  await cp(
    join(root, 'scripts/consumer-smoke-fonts.mjs'),
    join(app, 'apps/web/consumer-smoke-fonts.mjs'),
  )
  const configPath = join(app, 'apps/web/nuxt.config.ts')
  const config = await readFile(configPath, 'utf8')
  if (!config.includes('modules: [')) throw new Error('Cannot install the smoke font fixture.')
  await writeFile(
    configPath,
    config.replace('modules: [', "modules: ['./consumer-smoke-fonts.mjs',"),
  )
  run('pnpm', ['install', '--no-frozen-lockfile', '--strict-peer-dependencies'])
  const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
  // Reproduce Dependabot's recursive pnpm resolve with its cooldown override.
  // The workspace exclusion must keep fresh internal pins resolvable (#737).
  run('pnpm', [
    'update',
    `prettier@${manifest.devDependencies.prettier}`,
    '--lockfile-only',
    '--no-save',
    '-r',
    '--config.strict-peer-dependencies=true',
    ...(DEPENDABOT_COOLDOWN_DAYS > 0
      ? [`--config.minimum-release-age=${DEPENDABOT_COOLDOWN_DAYS * 1440}`]
      : []),
  ])
  run('pnpm', ['install', '--frozen-lockfile', '--strict-peer-dependencies'])
  run('pnpm', ['run', 'foundation:check:toolchain'])
  run('pnpm', ['run', 'typecheck'])
  run('pnpm', ['run', 'build:ci'])
  process.stdout.write(
    '\nGenerator pins passed generated-app install, Dependabot-style resolution, toolchain, typecheck and build.\n',
  )
  await rm(directory, { recursive: true, force: true })
} catch (error) {
  process.stderr.write(`\nFailed smoke fixture retained at ${app}\n`)
  throw error
}
