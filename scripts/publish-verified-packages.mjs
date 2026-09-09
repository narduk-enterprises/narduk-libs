import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registry = 'https://npm.pkg.github.com'

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
  const packages = loadWorkspace(root)
    .packages.map(({ manifest }) => manifest)
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
  // The workflow serializes publishers. Check every version before any write;
  // the Changesets action retains ownership of tag and GitHub release creation.
  const result = run('pnpm', ['exec', 'changeset', 'publish'], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Package publication failed (${result.status})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
