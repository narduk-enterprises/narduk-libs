import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

const registry = 'https://npm.pkg.github.com'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const planOnly = process.argv.includes('--plan')
const maxRegistryAttempts = 12
const registryRetryDelayMilliseconds = 5_000
const writeLine = (message) => process.stdout.write(`${message}\n`)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const packages = loadWorkspace(root)
  .packages.map(({ manifest }) => manifest)
  .filter((manifest) => manifest.private !== true)
  .sort((left, right) => left.name.localeCompare(right.name))

if (packages.length === 0) {
  throw new Error('No publishable packages found in the pnpm-workspace.yaml package families.')
}

for (const manifest of packages) {
  if (!manifest.name?.startsWith('@narduk-enterprises/')) {
    throw new Error(
      `Publishable package ${manifest.name || '<unnamed>'} is outside the expected scope.`,
    )
  }
  if (!manifest.version) throw new Error(`Publishable package ${manifest.name} has no version.`)
  if (manifest.publishConfig?.registry !== registry) {
    throw new Error(`${manifest.name} does not declare ${registry} as its publish registry.`)
  }
  writeLine(`${manifest.name}@${manifest.version}`)
}

if (planOnly) {
  writeLine(`Registry verification plan contains ${packages.length} exact package version(s).`)
  process.exit(0)
}

function readPublishedVersion(manifest) {
  const result = spawnSync(
    'pnpm',
    ['view', `${manifest.name}@${manifest.version}`, 'version', '--json', `--registry=${registry}`],
    { cwd: root, encoding: 'utf8' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) return undefined

  const output = result.stdout.trim()
  if (!output) return undefined
  try {
    const parsed = JSON.parse(output)
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return output
  }
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

let unresolved = [...packages]
for (let attempt = 1; attempt <= maxRegistryAttempts && unresolved.length > 0; attempt += 1) {
  unresolved = unresolved.filter((manifest) => {
    const publishedVersion = readPublishedVersion(manifest)
    if (publishedVersion === manifest.version) return false
    if (publishedVersion) {
      throw new Error(
        `${manifest.name}@${manifest.version} resolved an unexpected registry version ${publishedVersion}.`,
      )
    }
    return true
  })

  if (unresolved.length > 0 && attempt < maxRegistryAttempts) {
    writeLine(
      `Registry propagation attempt ${attempt}/${maxRegistryAttempts} is still waiting for ${unresolved.map((manifest) => `${manifest.name}@${manifest.version}`).join(', ')}.`,
    )
    wait(registryRetryDelayMilliseconds)
  }
}

if (unresolved.length > 0) {
  throw new Error(
    `Exact package versions did not resolve from ${registry}: ${unresolved.map((manifest) => `${manifest.name}@${manifest.version}`).join(', ')}.`,
  )
}

const consumerDirectory = mkdtempSync(join(tmpdir(), 'narduk-libs-registry-consumer-'))
try {
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'narduk-libs-registry-consumer-proof',
        private: true,
        packageManager: 'pnpm@10.33.4',
        dependencies: Object.fromEntries(
          packages.map((manifest) => [manifest.name, manifest.version]),
        ),
      },
      null,
      2,
    )}\n`,
  )

  execFileSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  })
  execFileSync('pnpm', ['install', '--ignore-scripts', '--frozen-lockfile'], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  })

  for (const manifest of packages) {
    const installedManifest = readJson(
      join(
        consumerDirectory,
        'node_modules',
        '@narduk-enterprises',
        manifest.name.slice('@narduk-enterprises/'.length),
        'package.json',
      ),
    )
    if (
      installedManifest.name !== manifest.name ||
      installedManifest.version !== manifest.version
    ) {
      throw new Error(
        `Registry consumer installed ${installedManifest.name}@${installedManifest.version}; expected ${manifest.name}@${manifest.version}.`,
      )
    }
  }

  writeLine(
    `Verified ${packages.length} immutable package version(s) from ${registry} with a frozen external consumer install.`,
  )
} finally {
  rmSync(consumerDirectory, { recursive: true, force: true })
}
