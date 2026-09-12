import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registry = 'https://npm.pkg.github.com'
const generatorName = '@narduk-enterprises/create-narduk-app'

function stableVersion(version) {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version || ''))
    throw new Error(`Expected a stable package version: ${version}`)
  return version.split('.').map(BigInt)
}

export function publicationPlan(packages, records) {
  return packages.filter((manifest) => {
    if (
      !manifest.name?.startsWith('@narduk-enterprises/') ||
      manifest.publishConfig?.registry !== registry
    )
      throw new Error('Package publication scope or registry is invalid')
    const target = stableVersion(manifest.version)
    const record = records[manifest.name]
    if (!record || !Array.isArray(record.versions)) throw new Error('Registry evidence is absent')
    if (record.versions.includes(manifest.version)) return false
    if (record.versions.length > 0 && !record.latest)
      throw new Error('Registry latest version is absent')
    if (record.latest) {
      const latest = stableVersion(record.latest)
      const difference = target.findIndex((part, index) => part !== latest[index])
      if (difference < 0 || target[difference] < latest[difference])
        throw new Error(`Refusing to move ${manifest.name} latest backwards`)
    }
    return true
  })
}

// The generator (create-narduk-app) never depends on the packages it pins --
// it only ever emits their name/version as string literals into generated
// apps' manifests (manifest.ts PACKAGE_VERSIONS), so changesets' own
// dependency graph cannot see this coupling. check-generator-release-plan.mjs
// already reuses this same regex to require a generator release whenever a
// pinned package's version changes; this reuses it again to confirm the pin
// will actually resolve before the generator carrying it publishes
// (narduk-libs#284).
function loadGeneratorPins(workspace) {
  const generator = workspace.byName.get(generatorName)
  if (!generator) throw new Error(`${generatorName} is not a workspace package.`)
  const localNames = new Set(
    workspace.packages
      .map(({ name }) => name)
      .filter((name) => typeof name === 'string' && name.startsWith('@narduk-enterprises/')),
  )
  const source = readFileSync(join(generator.directory, 'src', 'manifest.ts'), 'utf8')
  return new Map(
    [...source.matchAll(/^\s*'(@narduk-enterprises\/[^']+)':\s*'([^']+)',\s*$/gm)]
      .filter(([, name]) => localNames.has(name))
      .map(([, name, version]) => [name, version]),
  )
}

// A pin is safe to ship only if the version it names is already live on the
// registry, or is publishing in this exact batch (`pending`) at that same
// version -- never on the mere hope that some later, separate release will
// catch up. `0.0.0` cannot be rejected outright: it is the correct pin for a
// package that has genuinely never published (narduk-libs#284).
export function unresolvedGeneratorPins(pins, pending, records) {
  const releasing = new Map(pending.map((manifest) => [manifest.name, manifest.version]))
  return [...pins]
    .filter(([name, version]) => {
      const alreadyPublished = records[name]?.versions?.includes(version)
      const releasingNow = releasing.get(name) === version
      return !alreadyPublished && !releasingNow
    })
    .map(([name, version]) => `${name}@${version}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.error) throw result.error
  return result
}

function registryField(name, field, missingAllowed = false) {
  const result = run('pnpm', ['view', name, field, '--json', `--registry=${registry}`], {
    timeout: 30_000,
  })
  let value
  try {
    value = JSON.parse(result.stdout)
  } catch {
    throw new Error(`Registry metadata for ${name} is unreadable`)
  }
  if (result.status !== 0) {
    if (missingAllowed && value?.error?.code === 'E404') return undefined
    throw new Error(`Registry metadata for ${name} failed (${result.status})`)
  }
  return value
}

function main() {
  if (
    readdirSync(resolve(root, '.changeset')).some(
      (name) => name.endsWith('.md') && name !== 'README.md',
    )
  )
    throw new Error('Pending changesets must be versioned before publication')
  const workspace = loadWorkspace(root)
  const packages = workspace.packages
    .map(({ manifest }) => manifest)
    .filter((manifest) => manifest.private !== true)
  const records = Object.fromEntries(
    packages.map((manifest) => {
      const versions = registryField(manifest.name, 'versions', true)
      const tags = versions === undefined ? {} : registryField(manifest.name, 'dist-tags')
      return [
        manifest.name,
        {
          versions:
            versions === undefined ? [] : typeof versions === 'string' ? [versions] : versions,
          latest: tags?.latest,
        },
      ]
    }),
  )
  const pending = publicationPlan(packages, records)
  if (pending.length === 0) {
    console.log('All verified package versions are already published.')
    return
  }
  if (pending.some((manifest) => manifest.name === generatorName)) {
    const unresolved = unresolvedGeneratorPins(loadGeneratorPins(workspace), pending, records)
    if (unresolved.length > 0)
      throw new Error(
        `${generatorName} would publish with an unresolvable pin: ${unresolved.join(', ')}. Publish the pinned package first, or repin it to a version that is already published.`,
      )
  }
  // The workflow serializes publishers. Check every version before any write;
  // the Changesets action retains ownership of tag and GitHub release creation.
  const result = run('pnpm', ['exec', 'changeset', 'publish'], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Package publication failed (${result.status})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
