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
  run('pnpm', ['pack', '--pack-destination', packDir], repoRoot)
  run('pnpm', ['pack', '--pack-destination', packDir], packageRoot)

  const coreTarball = await findTarball(
    await packageTarballPrefix(join(repoRoot, 'package.json')),
  )
  const nuxtTarball = await findTarball(
    await packageTarballPrefix(join(packageRoot, 'package.json')),
  )
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'narduk-mapkit-packed-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@loganrenz/narduk-mapkit': `file:${coreTarball}`,
          '@loganrenz/narduk-mapkit-nuxt': `file:${nuxtTarball}`,
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
  modules: ['@loganrenz/narduk-mapkit-nuxt'],
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

  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumerDir)
  const installedLicense = await readFile(
    join(consumerDir, 'node_modules/@loganrenz/narduk-mapkit-nuxt/LICENSE'),
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
    'Built packed MapKit tarballs in a clean Cloudflare fixture and proved 503/403/200 binding behavior.',
  )
} finally {
  if (!process.env.NARDUK_MAPKIT_KEEP_PACKAGE_SMOKE) {
    await rm(tempRoot, { force: true, recursive: true })
  } else {
    console.log(`Preserved package smoke directory: ${dirname(consumerDir)}`)
  }
}
