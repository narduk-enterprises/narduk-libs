#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const packageRoot = process.cwd()
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const packageDir = resolve(
  process.env.NARDUK_MAPKIT_PACKAGE_DIR ??
    join(homedir(), 'Library/Application Support/NardukMapKit/packages'),
)
const safeName = String(pkg.name).replace(/^@/, '').replaceAll('/', '-')
const versionedTarball = `${safeName}-${pkg.version}.tgz`
const latestTarball = `${safeName}-latest.tgz`

mkdirSync(packageDir, { recursive: true })
execFileSync('pnpm', ['pack', '--pack-destination', packageDir], {
  stdio: 'inherit',
})

const versionedPath = join(packageDir, versionedTarball)
const latestPath = join(packageDir, latestTarball)
copyFileSync(versionedPath, latestPath)

let gitSha = ''
try {
  gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
} catch {
  gitSha = ''
}

writeFileSync(
  join(packageDir, `${safeName}-latest.json`),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      gitSha,
      tarball: latestPath,
      versionedTarball: versionedPath,
      publishedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)

console.log(`published ${pkg.name}@${pkg.version}`)
console.log(latestPath)
