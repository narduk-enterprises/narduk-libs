import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const tempRoot = await mkdtemp(join(tmpdir(), 'narduk-mapkit-nuxt-package-'))
const packDir = join(tempRoot, 'pack')
const consumerDir = join(tempRoot, 'consumer')
const registrySmoke = process.env.NARDUK_MAPKIT_REGISTRY_SMOKE === '1'

// Install the fixture with THIS package's pinned npm, not whatever npm the
// ambient Node happens to bundle. The fixture deliberately resolves a full
// Nuxt dependency graph, so it is exposed to npm's peer resolver -- and the
// npm 10.9.x bundled with Node 22 crashes on the current registry state of
// that graph with `TypeError: Cannot read properties of null (reading
// 'edgesOut')` inside arborist's #loadPeerSet. It is reproducible with
// nothing but `npm install nuxt@4.4.8 vue@3.5.39` on npm 10.9.4, and npm 11
// installs the same graph cleanly, so this is an upstream npm bug reached by
// registry drift rather than anything about the packed MapKit tarballs.
// Pinning the installer also makes the fixture reproducible instead of a
// function of the runner's Node build.
const npmBin = join(packageRoot, 'node_modules/.bin/npm')

async function packageManifest(packageJsonPath) {
  return JSON.parse(await readFile(packageJsonPath, 'utf8'))
}

async function packageTarballPrefix(packageJsonPath) {
  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const safeName = String(pkg.name).replace(/^@/, '').replaceAll('/', '-')
  return `${safeName}-${pkg.version}`
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
    stdio: 'pipe',
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`)
  }
  return result
}

function unsignedTokenWithFutureExpiry() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.fixture-signature`
}

function executionContext() {
  return { passThroughOnException() {}, waitUntil() {} }
}

async function expectStatus(worker, request, env, expectedStatus) {
  const response = await worker.fetch(request, env, executionContext())
  if (response.status !== expectedStatus) {
    throw new Error(
      `Packed Cloudflare fixture expected ${expectedStatus}, got ${response.status}: ${await response.text()}`,
    )
  }
  return response
}

async function findTarball(prefix) {
  const tarball = (await readdir(packDir)).find(
    (filename) => filename.startsWith(prefix) && filename.endsWith('.tgz'),
  )
  if (!tarball) throw new Error(`Packed tarball with prefix ${prefix} was not produced`)
  return join(packDir, tarball)
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesBelow(path)))
    else files.push(path)
  }
  return files
}

try {
  await mkdir(packDir, { recursive: true })
  await mkdir(consumerDir, { recursive: true })
  const coreManifest = await packageManifest(join(repoRoot, 'package.json'))
  const nuxtManifest = await packageManifest(join(packageRoot, 'package.json'))
  let coreSource = coreManifest.version
  let nuxtSource = nuxtManifest.version

  if (registrySmoke) {
    if (!process.env.NODE_AUTH_TOKEN?.trim()) {
      throw new Error('NARDUK_MAPKIT_REGISTRY_SMOKE requires NODE_AUTH_TOKEN.')
    }
    await writeFile(
      join(consumerDir, '.npmrc'),
      [
        '@narduk-geo:registry=https://npm.pkg.github.com',
        '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}',
        'registry=https://registry.npmjs.org/',
        '',
      ].join('\n'),
    )
  } else {
    run('pnpm', ['pack', '--pack-destination', packDir], repoRoot)
    run('pnpm', ['pack', '--pack-destination', packDir], packageRoot)
    coreSource = `file:${await findTarball(
      await packageTarballPrefix(join(repoRoot, 'package.json')),
    )}`
    nuxtSource = `file:${await findTarball(
      await packageTarballPrefix(join(packageRoot, 'package.json')),
    )}`
  }
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'narduk-mapkit-packed-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@narduk-geo/narduk-mapkit': coreSource,
          '@narduk-geo/narduk-mapkit-nuxt': nuxtSource,
          nuxt: '4.4.8',
          vue: '3.5.39',
        },
      },
      null,
      2,
    ),
  )
  await writeFile(
    join(consumerDir, 'nuxt.config.ts'),
    `export default defineNuxtConfig({
  modules: ['@narduk-geo/narduk-mapkit-nuxt'],
  compatibilityDate: '2026-07-14',
  nitro: { cloudflare: { nodeCompat: false } },
  sourcemap: false,
  vite: { build: { modulePreload: { polyfill: false } } },
})
`,
  )
  await writeFile(
    join(consumerDir, 'app.vue'),
    `<script setup lang="ts">
const { mapkitReady } = useMapKit()
</script>

<template>
  <div style="height: 240px">
    <AppMapKit :items="[]" />
    <span>{{ mapkitReady }}</span>
  </div>
</template>
`,
  )

  run(npmBin, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumerDir)
  const installedLicense = await readFile(
    join(consumerDir, 'node_modules/@narduk-geo/narduk-mapkit-nuxt/LICENSE'),
    'utf8',
  )
  if (!installedLicense.startsWith('MIT License')) {
    throw new Error('Packed Nuxt adapter is missing its MIT license text.')
  }
  const build = run(join(consumerDir, 'node_modules/.bin/nuxt'), ['build'], consumerDir, {
    env: { NITRO_PRESET: 'cloudflare-module' },
  })
  const buildOutput = `${build.stdout ?? ''}\n${build.stderr ?? ''}`.replaceAll(
    /\u001B\[[0-9;]*m/g,
    '',
  )
  if (/\bWARN\b|\bwarning\b|child_process|Node\.js compatibility is not enabled/i.test(buildOutput)) {
    process.stderr.write(build.stdout ?? '')
    process.stderr.write(build.stderr ?? '')
    throw new Error('Packed Cloudflare fixture emitted a warning or referenced Node-only code.')
  }

  const forbiddenBundleFiles = []
  for (const path of await filesBelow(join(consumerDir, '.output/server'))) {
    if (/child[_-]process/i.test(path)) forbiddenBundleFiles.push(path)
    if (!/\.(?:mjs|js)$/.test(path)) continue
    const source = await readFile(path, 'utf8')
    if (
      /(?:from\s*|import\s*\()\s*['"]node:[^'"]+|require\(\s*['"]node:[^'"]+/m.test(
        source,
      )
    ) {
      forbiddenBundleFiles.push(path)
    }
  }
  if (forbiddenBundleFiles.length > 0) {
    throw new Error(
      `Packed Cloudflare fixture contains Node built-ins:\n${forbiddenBundleFiles.join('\n')}`,
    )
  }

  const worker = (
    await import(
      `${pathToFileURL(join(consumerDir, '.output/server/index.mjs')).href}?packed=${Date.now()}`
    )
  ).default
  await expectStatus(
    worker,
    new Request('https://worker.example/api/mapkit-token'),
    {},
    503,
  )
  await expectStatus(
    worker,
    new Request('https://worker.example/api/mapkit-token', { method: 'POST' }),
    {},
    405,
  )

  const bindings = {}
  Object.defineProperties(bindings, {
    APPLE_MAPKIT_TOKEN: {
      enumerable: false,
      value: unsignedTokenWithFutureExpiry(),
    },
    MAPKIT_ALLOWED_ORIGINS: {
      enumerable: false,
      value: 'https://allowed.example',
    },
  })
  await expectStatus(
    worker,
    new Request('https://worker.example/api/mapkit-token', {
      headers: { origin: 'https://blocked.example' },
    }),
    bindings,
    403,
  )
  const success = await expectStatus(
    worker,
    new Request('https://worker.example/api/mapkit-token', {
      headers: { origin: 'https://allowed.example' },
    }),
    bindings,
    200,
  )
  const body = await success.json()
  if (!body.configured || !body.token) {
    throw new Error('Packed Cloudflare fixture did not hydrate non-enumerable bindings.')
  }

  console.log(
    `Built ${registrySmoke ? 'published MapKit packages' : 'packed MapKit tarballs'} in a clean Cloudflare fixture and proved 503/403/200/405 behavior.`,
  )
} finally {
  if (!process.env.NARDUK_MAPKIT_KEEP_PACKAGE_SMOKE) {
    await rm(tempRoot, { force: true, recursive: true })
  } else {
    console.log(`Preserved package smoke directory: ${dirname(consumerDir)}`)
  }
}
