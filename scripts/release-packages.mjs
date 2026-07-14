import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(root, 'packages')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const consumerSmoke = args.has('--consumer-smoke')

const writeLine = (message) => process.stdout.write(`${message}\n`)
const writeError = (message) => process.stderr.write(`${message}\n`)

if (!dryRun) {
  writeError('Refusing to run without --dry-run; this helper never publishes packages.')
  process.exit(1)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const packages = readdirSync(packageRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const directory = join(packageRoot, entry.name)
    const manifest = readJson(join(directory, 'package.json'))
    return { directory, manifest }
  })
  .filter(({ manifest }) => manifest.private !== true)
  .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))

if (packages.length === 0) {
  writeError('No publishable packages found under packages/.')
  process.exit(1)
}

for (const { directory, manifest } of packages) {
  if (!manifest.name?.startsWith('@narduk-enterprises/')) {
    throw new Error(`Package ${directory} is outside the @narduk-enterprises scope.`)
  }
  if (!manifest.version) {
    throw new Error(`Package ${manifest.name} has no version.`)
  }
  if (manifest.publishConfig?.registry !== 'https://npm.pkg.github.com') {
    throw new Error(`Package ${manifest.name} must publish to GitHub Packages.`)
  }

  writeLine(`Checking ${manifest.name}@${manifest.version}`)
  execFileSync('pnpm', ['exec', 'publint', directory, '--strict'], {
    cwd: root,
    stdio: 'inherit',
  })
  execFileSync('pnpm', ['pack', '--dry-run'], { cwd: directory, stdio: 'inherit' })
}

if (!consumerSmoke) {
  writeLine(`Dry run passed for ${packages.length} independent package(s).`)
  process.exit(0)
}

const consumerDirectory = mkdtempSync(join(tmpdir(), 'narduk-libs-consumer-'))
const tarballDirectory = join(consumerDirectory, 'tarballs')
const packageJsonPath = join(consumerDirectory, 'package.json')
mkdirSync(tarballDirectory, { recursive: true })

try {
  const tarballs = new Map()

  for (const { directory, manifest } of packages) {
    execFileSync('pnpm', ['pack', '--pack-destination', tarballDirectory], {
      cwd: directory,
      stdio: 'inherit',
    })
    const expectedTarball = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
    const tarball = readdirSync(tarballDirectory).find((entry) => entry === expectedTarball)
    if (!tarball) {
      throw new Error(`pnpm did not create a tarball for ${manifest.name}.`)
    }
    tarballs.set(manifest.name, join(tarballDirectory, tarball))
  }

  const dependencies = Object.fromEntries(
    packages.map(({ manifest }) => [manifest.name, `file:${tarballs.get(manifest.name)}`]),
  )
  writeFileSync(
    packageJsonPath,
    `${JSON.stringify(
      {
        name: 'narduk-libs-packed-consumer-smoke',
        private: true,
        packageManager: 'pnpm@10.33.4',
        dependencies,
      },
      null,
      2,
    )}\n`,
  )

  execFileSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  })

  for (const { manifest } of packages) {
    const installedManifestPath = join(
      consumerDirectory,
      'node_modules',
      '@narduk-enterprises',
      manifest.name.slice('@narduk-enterprises/'.length),
      'package.json',
    )
    const installedManifest = readJson(installedManifestPath)
    if (
      installedManifest.name !== manifest.name ||
      installedManifest.version !== manifest.version
    ) {
      throw new Error(`Packed consumer resolved the wrong artifact for ${manifest.name}.`)
    }
  }

  writeLine(`Packed consumer smoke passed for ${packages.length} package(s).`)
} finally {
  rmSync(consumerDirectory, { recursive: true, force: true })
}
