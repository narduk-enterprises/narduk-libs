#!/usr/bin/env node
/**
 * Built-artifact proof for narduk-libs#49: a prebuilt `cloudflare_module`
 * Worker, served by Wrangler local with a real local D1, keeps its D1 binding
 * on the nested Nitro request an SSR-relative `useFetch` makes.
 *
 * The unit suite (`tests/cloudflare-ssr-d1-binding.test.ts`) proves the
 * resolver. This proves the artifact: it builds `tests/fixtures/cf-ssr-d1-app`
 * once, then serves that exact `.output` three ways and reads the Worker's own
 * log, so a page that renders a fallback cannot count as green.
 *
 *   1. as built: `/api/probe` (outer), `/` (SSR `useFetch` -> nested
 *      `/api/probe`) and `/plain` (SSR global `$fetch` -> nested `/api/probe`)
 *      all carry the D1 value, and no log line says the binding is missing;
 *   2. control, the fix removed: the same artifact behind a wrapper that stops
 *      `globalThis.__env__` from being set (the isolate fallback #843 added).
 *      The outer request still reads D1; the `/plain` nested request must lose
 *      it and the log must say so -- if this run passes, the check above
 *      proves nothing. (`useFetch` forwards the request's own event context,
 *      so it keeps the binding either way; the global `$fetch` goes through
 *      Nitro's `localFetch` with a fresh event and no Cloudflare context,
 *      which is the path that lost it.);
 *   3. no D1 binding at all: `/api/probe` must fail closed with the
 *      missing-binding error, never an empty 200.
 *
 * The `.output` tree is hashed before and after: nothing here rebuilds or
 * edits the artifact, and no Nuxt dev server is involved.
 *
 * Usage: `pnpm --filter @narduk-enterprises/narduk-core run test:cf-ssr-d1`
 * (`--no-build` reuses an existing `.output`). Needs no network and no
 * Cloudflare account. Not part of `quality`: it builds a Nuxt app (~30 s).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(packageRoot, 'tests/fixtures/cf-ssr-d1-app')
const outputDir = join(fixtureRoot, '.output')
const MISSING_BINDING = 'D1 database binding not available'
const PROBE_VALUE = 'from-local-d1'
const READY_TIMEOUT_MS = 90_000

const skipBuild = process.argv.includes('--no-build')
const failures = []

function log(message) {
  console.log(`[prove-cf-ssr-d1] ${message}`)
}

function expect(condition, message) {
  if (condition) log(`ok   ${message}`)
  else {
    log(`FAIL ${message}`)
    failures.push(message)
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    )
  }
  return result
}

function hashTree(root) {
  const hash = createHash('sha256')
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else hash.update(relative(root, path)).update('\0').update(readFileSync(path))
    }
  }
  walk(root)
  return hash.digest('hex')
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

const wrangler = join(packageRoot, 'node_modules/.bin/wrangler')
const workDir = mkdtempSync(join(tmpdir(), 'prove-cf-ssr-d1-'))
const persistTo = join(workDir, 'state')
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }

/** A wrangler config over the built entry. `main` is the artifact itself, or a
 * wrapper that imports it unchanged. */
function writeConfig(name, main, { d1 }) {
  const path = join(workDir, `${name}.wrangler.json`)
  writeFileSync(
    path,
    JSON.stringify(
      {
        name: `cf-ssr-d1-${name}`,
        main,
        compatibility_date: '2026-01-01',
        compatibility_flags: ['nodejs_compat'],
        assets: { directory: join(outputDir, 'public'), binding: 'ASSETS' },
        ...(d1
          ? {
              d1_databases: [
                {
                  binding: 'DB',
                  database_name: 'probe',
                  database_id: '00000000-0000-4000-8000-000000000049',
                },
              ],
            }
          : {}),
      },
      null,
      2,
    ),
  )
  return path
}

/** Serves one config under `wrangler dev --local`, runs `probe`, stops it. */
async function serve(config, probe) {
  const port = await freePort()
  const child = spawn(
    wrangler,
    [
      'dev',
      '--local',
      '--config',
      config,
      '--persist-to',
      persistTo,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--show-interactive-dev-session=false',
      '--log-level',
      'log',
    ],
    { cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))

  try {
    const base = `http://127.0.0.1:${port}`
    const deadline = Date.now() + READY_TIMEOUT_MS
    for (;;) {
      if (child.exitCode !== null) throw new Error(`wrangler dev exited early:\n${output}`)
      try {
        await fetch(`${base}/favicon.ico`)
        break
      } catch {
        if (Date.now() > deadline) throw new Error(`wrangler dev never came up:\n${output}`)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    await probe(base)
    // Let the Worker flush its log lines for the requests above.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return output
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve()
      else child.once('exit', resolve)
    })
  }
}

async function getJson(url) {
  const response = await fetch(url)
  return { status: response.status, body: await response.text() }
}

try {
  if (!skipBuild) {
    log('building tests/fixtures/cf-ssr-d1-app (cloudflare_module)')
    run('npx', ['nuxi', 'build', fixtureRoot], { cwd: packageRoot, env, stdio: 'inherit' })
  }
  const before = hashTree(outputDir)
  const entry = join(outputDir, 'server/index.mjs')

  const withD1 = writeConfig('as-built', entry, { d1: true })
  run(
    wrangler,
    [
      'd1',
      'execute',
      'probe',
      '--local',
      '--config',
      withD1,
      '--persist-to',
      persistTo,
      '--command',
      `CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL); ` +
        `INSERT INTO probe (id, value) VALUES (1, '${PROBE_VALUE}');`,
    ],
    { cwd: workDir, env },
  )

  // 1. As built.
  log('run 1: the artifact as built, with a local D1')
  const asBuiltLog = await serve(withD1, async (base) => {
    const outer = await getJson(`${base}/api/probe`)
    expect(
      outer.status === 200 && outer.body.includes(PROBE_VALUE),
      `outer /api/probe answers 200 with the D1 value (got ${outer.status})`,
    )
    const page = await getJson(`${base}/`)
    expect(
      page.status === 200 && page.body.includes(`>${PROBE_VALUE}<`),
      `SSR page carries the D1 value from its nested /api/probe fetch (got ${page.status})`,
    )
    expect(!page.body.includes('FALLBACK'), 'SSR page did not render its fallback')
    const plain = await getJson(`${base}/plain`)
    expect(
      plain.status === 200 && plain.body.includes(`>${PROBE_VALUE}<`),
      `SSR page using the global $fetch carries the D1 value (got ${plain.status})`,
    )
  })
  expect(!asBuiltLog.includes(MISSING_BINDING), 'no Worker log line says the D1 binding is missing')

  // 2. Control: the isolate fallback blocked.
  log('run 2 (control): globalThis.__env__ blocked, so the nested request has no binding')
  const wrapper = join(workDir, 'no-isolate-env.mjs')
  writeFileSync(
    wrapper,
    [
      '// Nitro assigns globalThis.__env__ before every handler; drop the write.',
      "Object.defineProperty(globalThis, '__env__', { configurable: false, get: () => undefined, set: () => {} })",
      `export { default } from ${JSON.stringify(entry)}`,
      '',
    ].join('\n'),
  )
  const controlConfig = writeConfig('control', wrapper, { d1: true })
  const controlLog = await serve(controlConfig, async (base) => {
    const outer = await getJson(`${base}/api/probe`)
    expect(
      outer.status === 200 && outer.body.includes(PROBE_VALUE),
      `control: the outer request still reads D1 (got ${outer.status})`,
    )
    const plain = await getJson(`${base}/plain`)
    expect(
      !plain.body.includes(`>${PROBE_VALUE}<`),
      'control: without the fix, the global-$fetch nested request loses the D1 value',
    )
  })
  expect(
    controlLog.includes(MISSING_BINDING),
    'control: the Worker log names the missing binding (the defect this guards)',
  )

  // 3. No binding at all: fail closed.
  log('run 3: no D1 binding configured')
  const noD1 = writeConfig('no-d1', entry, { d1: false })
  await serve(noD1, async (base) => {
    const outer = await getJson(`${base}/api/probe`)
    expect(outer.status === 500, `a genuinely missing binding fails closed (got ${outer.status})`)
  })

  expect(hashTree(outputDir) === before, 'the prebuilt .output is byte-identical afterwards')
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
  console.error(error)
} finally {
  rmSync(workDir, { force: true, recursive: true })
}

if (failures.length > 0) {
  log(`${failures.length} check(s) failed`)
  process.exit(1)
}
log('all checks passed')
