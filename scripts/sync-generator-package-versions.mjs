import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Package directories come from pnpm-workspace.yaml (four families, see
// company-hq D-WEBFOUND-2 Q2 (a)), never from a fixed `packages/<name>` shape.
const workspace = loadWorkspace(root)
const generatorName = '@narduk-enterprises/create-narduk-app'
const generator = workspace.byName.get(generatorName)
if (!generator) throw new Error(`${generatorName} is not a workspace package.`)
const generatorRoot = generator.directory
const generatorPackagePath = join(generatorRoot, 'package.json')
const generatorManifestPath = join(generatorRoot, 'src', 'manifest.ts')
const generatorTypesPath = join(generatorRoot, 'src', 'types.ts')
const generatorReadmePath = join(generatorRoot, 'README.md')
const checkOnly = process.argv.includes('--check')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const localVersions = new Map(
  workspace.packages
    .map(({ manifest }) => manifest)
    .filter((manifest) => manifest.name?.startsWith('@narduk-enterprises/') && manifest.version)
    .map((manifest) => [manifest.name, manifest.version]),
)

const source = readFileSync(generatorManifestPath, 'utf8')
let updatedSource = source
const mismatches = []
let matchedPackages = 0

for (const [packageName, expectedVersion] of localVersions) {
  const pattern = new RegExp(`^(\\s*'${escapeRegExp(packageName)}':\\s*')([^']+)(',\\s*)$`, 'm')
  const match = updatedSource.match(pattern)
  if (!match) continue

  matchedPackages += 1
  const currentVersion = match[2]
  if (currentVersion === expectedVersion) continue

  mismatches.push(`${packageName}: ${currentVersion} -> ${expectedVersion}`)
  updatedSource = updatedSource.replace(pattern, `$1${expectedVersion}$3`)
}

if (matchedPackages === 0) {
  throw new Error('No local package versions were found in the generator manifest.')
}

const generatorVersion = readJson(generatorPackagePath).version
if (!generatorVersion) {
  throw new Error('The generator package manifest has no version.')
}

function synchronizeGeneratorVersion(path, pattern, label) {
  const contents = readFileSync(path, 'utf8')
  const match = contents.match(pattern)
  if (!match) throw new Error(`Could not find ${label} in ${path}.`)
  if (match[2] === generatorVersion) return { contents, updated: false }

  mismatches.push(`${label}: ${match[2]} -> ${generatorVersion}`)
  return {
    contents: contents.replace(pattern, `$1${generatorVersion}$3`),
    updated: true,
  }
}

const generatorTypes = synchronizeGeneratorVersion(
  generatorTypesPath,
  /^(export const GENERATOR_VERSION = ')([^']+)(')$/m,
  'generator report version',
)
const generatorReadme = synchronizeGeneratorVersion(
  generatorReadmePath,
  /^(pnpm dlx @narduk-enterprises\/create-narduk-app@)([^\s]+)(\s)/m,
  'generator README command version',
)

if (checkOnly) {
  if (mismatches.length > 0) {
    process.stderr.write(
      `Generator release versions do not match local package manifests:\n${mismatches
        .map((mismatch) => `- ${mismatch}`)
        .join('\n')}\nRun pnpm run versions:sync after versioning packages.\n`,
    )
    process.exit(1)
  }

  process.stdout.write(
    `Generator release metadata and ${matchedPackages} local package pins match their package manifests.\n`,
  )
  process.exit(0)
}

if (mismatches.length === 0) {
  process.stdout.write(
    'Generator release metadata and package pins already match package manifests.\n',
  )
  process.exit(0)
}

if (updatedSource !== source) writeFileSync(generatorManifestPath, updatedSource)
if (generatorTypes.updated) writeFileSync(generatorTypesPath, generatorTypes.contents)
if (generatorReadme.updated) writeFileSync(generatorReadmePath, generatorReadme.contents)
process.stdout.write(
  `Updated generator release versions:\n${mismatches.map((item) => `- ${item}`).join('\n')}\n`,
)
