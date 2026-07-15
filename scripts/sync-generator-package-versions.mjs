import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = join(root, 'packages')
const generatorRoot = join(packagesRoot, 'create-narduk-app')
const generatorPackagePath = join(generatorRoot, 'package.json')
const generatorManifestPath = join(generatorRoot, 'src', 'manifest.ts')
const generatorTypesPath = join(generatorRoot, 'src', 'types.ts')
const generatorReadmePath = join(generatorRoot, 'README.md')
const checkOnly = process.argv.includes('--check')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const localVersions = new Map(
  readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJson(join(packagesRoot, entry.name, 'package.json')))
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
