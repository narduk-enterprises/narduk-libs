#!/usr/bin/env node
/**
 * Proves the nonce CSP against a real Nuxt render, which a unit test cannot:
 * what Nuxt emits as inline scripts is decided by its renderer at build time.
 * Not part of `test:unit` (it builds a Nitro server). Run: `pnpm prove:nonce`.
 *
 * Exits nonzero unless: the CSP has a real nonce and no 'unsafe-inline';
 * `frame-ancestors` and `default-src` are in the enforced header; every
 * <script> in the page, the hydration payload included, carries that nonce;
 * a second request gets a different nonce; the HTML is private, no-store.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/nonce-app')
const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

function run(command, args, options) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', fail)
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${command} exited ${code}`))))
  })
}

await run('npx', ['nuxi', 'build'], { cwd: fixture })

const port = 3124
const origin = `http://127.0.0.1:${port}`
const server = spawn('node', ['.output/server/index.mjs'], {
  cwd: fixture,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' },
  stdio: ['ignore', 'inherit', 'inherit'],
})

try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}`)
    if (i > 120) throw new Error('server did not answer')
    try {
      await fetch(origin)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  const first = await fetch(origin)
  const html = await first.text()
  const csp = first.headers.get('content-security-policy') ?? ''
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1]

  check(Boolean(nonce), 'the enforced CSP carries a per-request nonce', csp)
  check(!csp.includes('unsafe-inline'), "the enforced CSP has no 'unsafe-inline'")
  check(
    /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp),
    'default-src and frame-ancestors are enforced',
  )
  check(
    (first.headers.get('cache-control') ?? '') === 'private, no-store',
    'the HTML is private, no-store',
    first.headers.get('cache-control') ?? '',
  )

  const tags = html.match(/<script\b[^>]*>/gi) ?? []
  const unstamped = tags.filter((tag) => !tag.includes(`nonce="${nonce}"`))
  check(tags.length > 0, 'the page has script tags to check', `${tags.length} found`)
  check(unstamped.length === 0, 'every script tag carries the served nonce', unstamped.join(' | '))
  const payload = tags.find((tag) => tag.includes('__NUXT_DATA__'))
  check(
    Boolean(payload) && payload.includes(`nonce="${nonce}"`),
    "Nuxt's hydration payload script carries the nonce",
    payload ?? 'no payload script in the page',
  )
  const inline = html.match(/<script(?![^>]*\ssrc=)[^>]*>/gi) ?? []
  console.log(`[prove-nonce] ${inline.length} inline script tag(s):`, inline.join(' '))

  const second = await fetch(origin)
  await second.text()
  const secondNonce = /'nonce-([^']+)'/.exec(
    second.headers.get('content-security-policy') ?? '',
  )?.[1]
  check(Boolean(secondNonce) && secondNonce !== nonce, 'a second request gets a different nonce')
} finally {
  server.kill('SIGTERM')
  await once(server, 'exit').catch(() => undefined)
}

if (failures.length > 0) {
  console.error(`\n[prove-nonce] ${failures.length} failed: ${failures.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('\n[prove-nonce] all checks passed')
}
