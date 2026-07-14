import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = join(root, 'packages')
const generatorManifestPath = join(packagesRoot, 'create-narduk-app', 'src', 'manifest.ts')
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

if (checkOnly) {
  if (mismatches.length > 0) {
    process.stderr.write(
      `Generator package pins do not match local release versions:\n${mismatches
        .map((mismatch) => `- ${mismatch}`)
        .join('\n')}\nRun pnpm run versions:sync after versioning packages.\n`,
    )
    process.exit(1)
  }

  process.stdout.write(`Generator package pins match ${matchedPackages} local package versions.\n`)
  process.exit(0)
}

if (mismatches.length === 0) {
  process.stdout.write('Generator package pins already match local release versions.\n')
  process.exit(0)
}

writeFileSync(generatorManifestPath, updatedSource)
process.stdout.write(
  `Updated generator package pins:\n${mismatches.map((item) => `- ${item}`).join('\n')}\n`,
)
