import { execFileSync, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const registry = 'https://npm.pkg.github.com'
const retryDelayMilliseconds = 5_000
const maxAttempts = 12

const manifests = await Promise.all(
  ['package.json', 'packages/nuxt/package.json'].map(async (relativePath) =>
    JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8')),
  ),
)

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function publishedVersion({ name, version }) {
  const result = spawnSync(
    'npm',
    ['view', `${name}@${version}`, 'version', '--json', `--registry=${registry}`],
    { cwd: repoRoot, encoding: 'utf8', env: process.env },
  )
  if (result.status !== 0) return null
  return JSON.parse(result.stdout)
}

for (const manifest of manifests) {
  let resolved = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    resolved = publishedVersion(manifest)
    if (resolved === manifest.version) break
    if (attempt < maxAttempts) wait(retryDelayMilliseconds)
  }
  if (resolved !== manifest.version) {
    throw new Error(
      `${manifest.name}@${manifest.version} did not resolve from ${registry}; received ${String(resolved)}.`,
    )
  }
}

execFileSync(
  'pnpm',
  ['--filter', '@narduk-geo/narduk-mapkit-nuxt', 'run', 'check:package'],
  {
    cwd: repoRoot,
    env: { ...process.env, NARDUK_MAPKIT_REGISTRY_SMOKE: '1' },
    stdio: 'inherit',
  },
)

console.log(
  `Verified ${manifests.map(({ name, version }) => `${name}@${version}`).join(' and ')} from ${registry}.`,
)
