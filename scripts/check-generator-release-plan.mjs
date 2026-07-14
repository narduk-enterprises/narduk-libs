import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = join(root, 'packages')
const generatorName = '@narduk-enterprises/create-narduk-app'
const generatorManifestPath = join(packagesRoot, 'create-narduk-app', 'src', 'manifest.ts')

const localPackageNames = new Set(
  readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      JSON.parse(readFileSync(join(packagesRoot, entry.name, 'package.json'), 'utf8')),
    )
    .map((manifest) => manifest.name)
    .filter((name) => typeof name === 'string' && name.startsWith('@narduk-enterprises/')),
)

const generatorSource = readFileSync(generatorManifestPath, 'utf8')
const pinnedLocalPackages = new Set(
  [...generatorSource.matchAll(/^\s*'(@narduk-enterprises\/[^']+)':\s*'[^']+',\s*$/gm)]
    .map((match) => match[1])
    .filter((name) => localPackageNames.has(name)),
)

if (pinnedLocalPackages.size === 0) {
  throw new Error('The generator release guard found no local package pins.')
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'narduk-libs-release-plan-'))
const statusPath = join(temporaryDirectory, 'status.json')

try {
  execFileSync('pnpm', ['exec', 'changeset', 'status', '--output', statusPath], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  const status = JSON.parse(readFileSync(statusPath, 'utf8'))
  const plannedReleases = status.releases.filter((release) => release.type !== 'none')
  const changedPins = plannedReleases.filter((release) => pinnedLocalPackages.has(release.name))
  const generatorRelease = plannedReleases.find((release) => release.name === generatorName)

  if (changedPins.length > 0 && !generatorRelease) {
    process.stderr.write(
      `The release changes generator-owned package pins without releasing ${generatorName}:\n${changedPins
        .map((release) => `- ${release.name}: ${release.oldVersion} -> ${release.newVersion}`)
        .join('\n')}\nAdd a patch changeset for ${generatorName}.\n`,
    )
    process.exit(1)
  }

  process.stdout.write(
    changedPins.length === 0
      ? 'Release plan does not change generator-owned package pins.\n'
      : `Release plan updates ${changedPins.length} generator-owned package pin(s) and releases ${generatorName}.\n`,
  )
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
