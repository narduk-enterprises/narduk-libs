import { spawnSync } from 'node:child_process'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const outputRoot = join(packageRoot, 'playground/.output')
const serverRoot = join(outputRoot, 'server')

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`)
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
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

function unsignedTokenWithFutureExpiry() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.fixture-signature`
}

function executionContext() {
  return {
    passThroughOnException() {},
    waitUntil() {},
  }
}

async function fetchStatus(worker, request, env) {
  return worker.fetch(request, env, executionContext())
}

async function assertStatus(worker, request, env, expectedStatus) {
  const response = await fetchStatus(worker, request, env)
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus} for ${request.method} ${request.url}, got ${response.status}: ${await response.text()}`,
    )
  }
  return response
}

await rm(outputRoot, { force: true, recursive: true })
run('pnpm', ['run', 'dev:prepare'])
const buildOutput = run('pnpm', ['exec', 'nuxt', 'build', 'playground'], {
  NITRO_PRESET: 'cloudflare-module',
})

// Stripping ANSI SGR escapes from captured build output is exactly what this
// control character is for.
// eslint-disable-next-line no-control-regex -- intentional ANSI strip
const normalizedOutput = buildOutput.replaceAll(/\u001B\[[0-9;]*m/g, '')
if (/\bWARN\b|\bwarning\b/i.test(normalizedOutput)) {
  throw new Error('Cloudflare build emitted a warning; release builds must be warning-free.')
}
if (/child_process|Node\.js compatibility is not enabled/i.test(normalizedOutput)) {
  throw new Error('Cloudflare build output references a Node-only compatibility path.')
}

const builtFiles = await filesBelow(serverRoot)
const forbiddenImports = []
for (const path of builtFiles) {
  if (/child[_-]process/i.test(path)) forbiddenImports.push(path)
  if (!/\.(?:mjs|js)$/.test(path)) continue
  const source = await readFile(path, 'utf8')
  if (/(?:from|import\s*\()\s*['"]node:[^'"]+|require\(\s*['"]node:[^'"]+/.test(source)) {
    forbiddenImports.push(path)
  }
}
if (forbiddenImports.length > 0) {
  throw new Error(
    `Cloudflare bundle contains Node.js built-in imports:\n${forbiddenImports.join('\n')}`,
  )
}

const moduleUrl = `${pathToFileURL(join(serverRoot, 'index.mjs')).href}?gate=${Date.now()}`
const worker = (await import(moduleUrl)).default
if (!worker || typeof worker.fetch !== 'function') {
  throw new Error('Cloudflare module build does not export a fetch handler.')
}

await assertStatus(worker, new Request('https://worker.example/api/mapkit-token'), {}, 503)

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

await assertStatus(
  worker,
  new Request('https://worker.example/api/mapkit-token', {
    headers: { origin: 'https://blocked.example' },
  }),
  bindings,
  403,
)
const success = await assertStatus(
  worker,
  new Request('https://worker.example/api/mapkit-token', {
    headers: { origin: 'https://allowed.example' },
  }),
  bindings,
  200,
)
const successBody = await success.json()
if (!successBody.configured || typeof successBody.token !== 'string' || !successBody.token) {
  throw new Error('Cloudflare binding hydration did not produce a configured token response.')
}

const postResponse = await fetchStatus(
  worker,
  new Request('https://worker.example/api/mapkit-token', { method: 'POST' }),
  bindings,
)
if (postResponse.status !== 405 || postResponse.headers.get('allow') !== 'GET') {
  throw new Error(`POST reached the GET-only token route (status ${postResponse.status}).`)
}

console.log(
  'Cloudflare module build is warning-free, Node-built-in-free, GET-only, and passes 503/403/200 binding proofs.',
)
