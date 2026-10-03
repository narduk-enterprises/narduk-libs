/**
 * narduk-libs#1379: built proof that the css-mode stylesheet scan is gone from
 * the hydration path with no visual change.
 *
 * `tests/fixtures/icon-css-scan-app` is built twice, once with narduk-core's
 * default (patched) and once with `NARDUK_ICON_CSS_SCAN=upstream` (the stock
 * `@nuxt/icon` scan). The bundle check always runs. The browser check serves
 * both builds, then compares the icons at first paint (JS off), after
 * hydration, and the DOM, and counts CSSOM reads. It skips when Playwright's
 * Chromium is not installed.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/icon-css-scan-app')
const require = createRequire(fileURLToPath(import.meta.url))
const nuxtManifestPath = require.resolve('nuxt/package.json')
const nuxtBinField = (
  JSON.parse(readFileSync(nuxtManifestPath, 'utf8')) as { bin?: { nuxt?: string } }
).bin?.nuxt
if (!nuxtBinField) throw new Error('nuxt package.json has no bin.nuxt')
const nuxtBin = join(dirname(nuxtManifestPath), nuxtBinField)

const work = mkdtempSync(join(tmpdir(), 'narduk-icon-css-scan-'))
const outputs = { patched: join(work, 'patched'), upstream: join(work, 'upstream') }
const servers: ChildProcess[] = []

function build(variant: 'patched' | 'upstream'): void {
  rmSync(join(fixtureRoot, '.output'), { force: true, recursive: true })
  const result = spawnSync(process.execPath, [nuxtBin, 'build'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NUXT_TELEMETRY_DISABLED: '1',
      ...(variant === 'upstream' ? { NARDUK_ICON_CSS_SCAN: 'upstream' } : {}),
    },
    timeout: 240_000,
  })
  if (result.status !== 0) {
    throw new Error(
      `nuxt build (${variant}) exited ${result.status ?? 'null'}\n${result.stdout}\n${result.stderr}`,
    )
  }
  cpSync(join(fixtureRoot, '.output'), outputs[variant], { recursive: true })
}

function clientBundle(variant: 'patched' | 'upstream'): string {
  const dir = join(outputs[variant], 'public/_nuxt')
  return readdirSync(dir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n')
}

beforeAll(() => {
  build('patched')
  build('upstream')
}, 480_000)

afterAll(() => {
  for (const server of servers) server.kill()
  rmSync(work, { force: true, recursive: true })
  for (const dir of ['.nuxt', '.output', '.data']) {
    rmSync(join(fixtureRoot, dir), { force: true, recursive: true })
  }
})

describe('icon css scan in a built app (narduk-libs#1379)', () => {
  it('ships no stylesheet scan in the default client bundle, and the control still has it', () => {
    expect(clientBundle('upstream')).toContain('styleSheets')
    const patched = clientBundle('patched')
    expect(patched).not.toContain('styleSheets')
    expect(patched).toMatch(/querySelectorAll\(["'`]style["'`]\)/)
  })
})

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolvePort(port))
    })
  })
}

async function serve(variant: 'patched' | 'upstream'): Promise<string> {
  const port = await freePort()
  const server = spawn(process.execPath, [join(outputs[variant], 'server/index.mjs')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  })
  servers.push(server)
  const url = `http://127.0.0.1:${port}/`
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return url
    } catch {
      /* not listening yet */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`${variant} fixture server did not start`)
}

const chromiumInstalled = existsSync(chromium.executablePath())

/** Asset hashes, build ids and scripts differ between two builds of one source. */
function normalize(html: string): string {
  return html
    .replaceAll(/<script[\s\S]*?<\/script>/g, '')
    .replaceAll(/\/_nuxt\/[\w.-]+\.(js|css)/g, '/_nuxt/HASH.$1')
    .replaceAll(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'UUID')
}

interface Capture {
  cssomReads: number
  dom: string
  firstPaint: Buffer
  hydrated: Buffer
  iconMasks: Array<{ icon: string; masked: boolean }>
}

async function capture(url: string): Promise<Capture> {
  const browser = await chromium.launch()
  try {
    const viewport = { width: 800, height: 400 }
    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport })
    const noJsPage = await noJs.newPage()
    await noJsPage.goto(url, { waitUntil: 'load' })
    const firstPaint = await noJsPage.screenshot()
    await noJs.close()

    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.addInitScript(() => {
      const original = Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype, 'cssRules')
      ;(window as unknown as { __cssomReads: number }).__cssomReads = 0
      Object.defineProperty(CSSStyleSheet.prototype, 'cssRules', {
        configurable: true,
        get() {
          ;(window as unknown as { __cssomReads: number }).__cssomReads += 1
          return original?.get?.call(this)
        },
      })
    })
    await page.goto(url, { waitUntil: 'load' })
    // The client-only icon is the last thing hydration mounts.
    await page.waitForSelector('#late-icon .iconify')
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#late-icon .iconify')
        return !!el && getComputedStyle(el).webkitMaskImage !== 'none'
      },
      undefined,
      { timeout: 10_000 },
    )
    const hydrated = await page.screenshot()
    const dom = normalize(await page.evaluate(() => document.documentElement.outerHTML))
    const cssomReads = await page.evaluate(
      () => (window as unknown as { __cssomReads: number }).__cssomReads,
    )
    const iconMasks = await page.evaluate(() =>
      [...document.querySelectorAll('.iconify')].map((el) => ({
        icon: [...el.classList].find((name) => name.startsWith('i-')) ?? '',
        masked: getComputedStyle(el).webkitMaskImage !== 'none',
      })),
    )
    await context.close()
    return { firstPaint, hydrated, dom, cssomReads, iconMasks }
  } finally {
    await browser.close()
  }
}

describe.skipIf(!chromiumInstalled)('icons render the same with and without the scan', () => {
  let patched: Capture
  let upstream: Capture

  beforeAll(async () => {
    patched = await capture(await serve('patched'))
    upstream = await capture(await serve('upstream'))
  }, 120_000)

  it('reads no stylesheet rules during hydration, where the stock scan reads them', () => {
    expect(upstream.cssomReads).toBeGreaterThan(0)
    expect(patched.cssomReads).toBe(0)
  })

  it('paints every icon, server-rendered and client-only', () => {
    for (const capture of [patched, upstream]) {
      expect(capture.iconMasks.map((entry) => entry.icon).sort()).toEqual(
        [
          'i-lucide:check',
          'i-lucide:copy',
          'i-lucide:menu',
          'i-lucide:moon',
          'i-lucide:search',
          'i-lucide:sun',
          'i-lucide:x',
        ].sort(),
      )
      expect(capture.iconMasks.every((entry) => entry.masked)).toBe(true)
    }
  })

  it('is pixel-identical at first paint (JavaScript off) and after hydration', () => {
    expect(patched.firstPaint.equals(upstream.firstPaint)).toBe(true)
    expect(patched.hydrated.equals(upstream.hydrated)).toBe(true)
  })

  it('leaves the same DOM, with one injected style for the client-only icon', () => {
    expect(patched.dom).toBe(upstream.dom)
    const searchStyles = patched.dom.match(/:where\(\.i-lucide\\:search\)/g) ?? []
    expect(searchStyles).toHaveLength(1)
  })
})
