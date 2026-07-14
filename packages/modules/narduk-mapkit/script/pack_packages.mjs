import { spawnSync } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const packDir = fileURLToPath(new URL('../.pack', import.meta.url))
const nuxtPackageRoot = fileURLToPath(new URL('../packages/nuxt', import.meta.url))

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`)
  }
}

await rm(packDir, { force: true, recursive: true })
await mkdir(packDir, { recursive: true })
run('pnpm', ['pack', '--pack-destination', packDir], repoRoot)
run('pnpm', ['pack', '--pack-destination', packDir], nuxtPackageRoot)

const artifacts = (await readdir(packDir)).filter((entry) => entry.endsWith('.tgz')).sort()
if (artifacts.length !== 2) {
  throw new Error(`Expected two package tarballs, found ${artifacts.length}: ${artifacts.join(', ')}`)
}
console.log(`Packed release candidates:\n${artifacts.join('\n')}`)
