#!/usr/bin/env node
/**
 * Proves the `security.headers` nonce strategy works with Nuxt's inline
 * hydration payload, which is the one claim a unit test genuinely cannot make:
 * whether a nonce lands on the payload `<script>` is decided by Nuxt's
 * renderer and nuxt-security's `render:html` hook at build and request time.
 *
 * Not part of `test:unit`. It builds a real Nitro server (tens of seconds) and,
 * for the console half, needs a Playwright browser binary. Run it by hand when
 * the preset, the Nuxt major, or the nuxt-security version moves:
 *
 *     node scripts/prove-nonce.mjs
 *     node scripts/prove-nonce.mjs --skip-browser   # headers + HTML only
 *
 * It asserts four things and exits nonzero on any of them:
 *
 *   1. the served CSP carries a real `'nonce-…'`, not the `{{nonce}}` literal;
 *   2. every `<script>` in the rendered HTML carries that exact nonce --
 *      including the inline hydration payload, which is the whole point;
 *   3. two requests get two different nonces, because a nonce reused across
 *      responses is worth no more than `'unsafe-inline'`;
 *   4. loading the page in Chromium logs no CSP violation and hydrates.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = resolve(here, '../tests/fixtures/nonce-app')
const skipBrowser = process.argv.includes('--skip-browser')

const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)),
    )
  })
}

async function waitForServer(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`)
    try {
      const response = await fetch(url, { redirect: 'manual' })
      if (response.status < 500) return
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`server did not answer ${url} within ${timeoutMs}ms`)
}

console.log(`[prove-nonce] building ${fixture}`)
await run('npx', ['nuxi', 'build'], { cwd: fixture })

const port = 3123
const origin = `http://127.0.0.1:${port}`
// workerd, not Node. narduk-core pins Nitro's `cloudflare-module` preset, and
// the whole reason nuxt-security was adoptable is that its runtime uses only
// Web APIs -- proving the nonce on a Node server would leave exactly the claim
// that mattered unproven. This is the same prebuilt-Worker local run the Buoys
// adoption uses.
const server = spawn(
  'npx',
  [
    'wrangler',
    'dev',
    '.output/server/index.mjs',
    '--assets',
    '.output/public',
    // Without a wrangler config, wrangler defaults the compatibility date to
    // today, which the workerd binary shipped with the pinned wrangler does not
    // yet recognise. Pin it to a date that binary supports.
    '--compatibility-date',
    '2026-07-01',
    '--port',
    String(port),
    '--ip',
    '127.0.0.1',
    '--local',
  ],
  {
    cwd: fixture,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_API_TOKEN: '' },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
)

try {
  await waitForServer(origin, server)

  const first = await fetch(origin)
  const html = await first.text()
  const csp = first.headers.get('content-security-policy')

  check(Boolean(csp), 'an enforcing Content-Security-Policy is served')
  check(
    Boolean(csp) && !csp.includes('{{nonce}}'),
    'the nonce placeholder was substituted',
    csp?.includes('{{nonce}}') ? 'the literal {{nonce}} reached the wire' : '',
  )

  const headerNonce = /'nonce-([^']+)'/.exec(csp ?? '')?.[1]
  check(Boolean(headerNonce), 'the policy carries a per-request nonce', headerNonce ?? 'none found')

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []
  const withoutNonce = scriptTags.filter((tag) => !tag.includes(`nonce="${headerNonce}"`))
  check(
    scriptTags.length > 0,
    'the rendered page contains script tags to check',
    `${scriptTags.length} found`,
  )
  check(
    withoutNonce.length === 0,
    'every script tag carries the served nonce',
    withoutNonce.length > 0 ? withoutNonce.slice(0, 3).join(' | ') : '',
  )

  // The payload script is the specific thing the brief asks about: Nuxt
  // serializes SSR state into an inline script, and an inline script under a
  // nonce policy with no 'unsafe-inline' is blocked unless it is stamped.
  const payloadTag = scriptTags.find(
    (tag) => tag.includes('__NUXT_DATA__') || tag.includes('application/json'),
  )
  check(
    Boolean(payloadTag) && payloadTag.includes(`nonce="${headerNonce}"`),
    "Nuxt's inline hydration payload carries the nonce",
    payloadTag ?? 'no payload script found in the rendered HTML',
  )

  const second = await fetch(origin)
  await second.text()
  const secondNonce = /'nonce-([^']+)'/.exec(
    second.headers.get('content-security-policy') ?? '',
  )?.[1]
  check(
    Boolean(secondNonce) && secondNonce !== headerNonce,
    'a second request gets a different nonce',
    `${headerNonce} vs ${secondNonce}`,
  )

  if (skipBrowser) {
    console.log('[prove-nonce] --skip-browser: console check not run')
  } else {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    const page = await browser.newPage()
    const violations = []
    page.on('console', (message) => {
      const text = message.text()
      if (/Content Security Policy|Refused to (?:execute|load|apply)/i.test(text)) {
        violations.push(text)
      }
    })
    page.on('pageerror', (error) => violations.push(`pageerror: ${error.message}`))
    await page.goto(origin, { waitUntil: 'networkidle' })
    const station = await page.getByTestId('station').textContent()
    check(station === '41008', 'the page rendered and hydrated', `station=${station}`)
    check(
      violations.length === 0,
      'no CSP violation reached the browser console',
      violations.slice(0, 5).join(' | '),
    )
    await browser.close()
  }
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
