import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tempRoot = await mkdtemp(join(tmpdir(), 'narduk-mapkit-package-'))
const packDir = join(tempRoot, 'pack')
const projectDir = join(tempRoot, 'consumer')
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`)
  }
  return result
}

try {
  await mkdir(packDir, { recursive: true })
  await mkdir(projectDir, { recursive: true })
  run('pnpm', ['pack', '--pack-destination', packDir], { cwd: repoRoot })

  const tarball = (await readdir(packDir)).find((file) => file.endsWith('.tgz'))
  if (!tarball) throw new Error('pnpm pack did not produce a tarball')

  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  )
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(packDir, tarball)], {
    cwd: projectDir,
  })

  await writeFile(
    join(projectDir, 'smoke.mjs'),
    `
import * as root from '@loganrenz/narduk-mapkit'
import * as appleMaps from '@loganrenz/narduk-mapkit/apple-maps'
import * as client from '@loganrenz/narduk-mapkit/client'
import * as geometry from '@loganrenz/narduk-mapkit/geometry'
import * as nodeServer from '@loganrenz/narduk-mapkit/node'
import * as playback from '@loganrenz/narduk-mapkit/playback'
import * as server from '@loganrenz/narduk-mapkit/server'
import * as token from '@loganrenz/narduk-mapkit/token'
import * as worker from '@loganrenz/narduk-mapkit/worker'

const checks = [
  ['root.computeRouteDistanceMetres', root.computeRouteDistanceMetres],
  ['client.initializeMapKit', client.initializeMapKit],
  ['client.createMapKitTileOverlay', client.createMapKitTileOverlay],
  ['client.createBoundsGatedUrlTemplate', client.createBoundsGatedUrlTemplate],
  ['client.addMapKitVectorOverlay', client.addMapKitVectorOverlay],
  ['client.MapKitLayerRegistry', client.MapKitLayerRegistry],
  ['geometry.computeMapKitRegionForPoints', geometry.computeMapKitRegionForPoints],
  ['playback.buildMapKitPlaybackLineSlices', playback.buildMapKitPlaybackLineSlices],
  ['server.createMapKitTokenHandler', server.createMapKitTokenHandler],
  ['worker.mapKitTokenResponseFromEnv', worker.mapKitTokenResponseFromEnv],
  ['nodeServer.resolveMapKitServerConfig', nodeServer.resolveMapKitServerConfig],
  ['appleMaps.searchAppleMaps', appleMaps.searchAppleMaps],
  ['appleMaps.geocodeAppleMaps', appleMaps.geocodeAppleMaps],
  ['appleMaps.getAppleMapsAccessToken', appleMaps.getAppleMapsAccessToken],
  ['token.createMapKitToken', token.createMapKitToken],
]

for (const [name, value] of checks) {
  if (typeof value !== 'function') throw new Error(name + ' is not exported')
}

if ('base64urlEncode' in token) {
  throw new Error('token subpath exposes internal crypto helpers')
}
`,
  )
  run('node', ['smoke.mjs'], { cwd: projectDir })
  console.log(`Installed and imported ${tarball} in a clean temp project.`)
} finally {
  if (!process.env.NARDUK_MAPKIT_KEEP_PACKAGE_SMOKE) {
    await rm(tempRoot, { force: true, recursive: true })
  }
}
