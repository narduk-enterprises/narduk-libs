/**
 * narduk-libs#1369, proved on real builds: the three first-paint defaults
 * reach the output of a consumer that names none of them, and the module
 * option switches them off again.
 *
 * Three builds of `fixtures/performance-defaults-app`, run side by side into
 * their own directories: the defaults, the opt-out, and the defaults with
 * narduk-core's own `app` surface on (whose `U*` components must stay in the
 * detected set, which only holds if core's additions reach Nuxt UI's options).
 */
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/performance-defaults-app',
)
const require = createRequire(fileURLToPath(import.meta.url))
const nuxtManifestPath = require.resolve('nuxt/package.json')
const nuxtBinField = (
  JSON.parse(readFileSync(nuxtManifestPath, 'utf8')) as { bin?: { nuxt?: string } }
).bin?.nuxt
if (!nuxtBinField) throw new Error('nuxt package.json has no bin.nuxt')
const nuxtBin = join(dirname(nuxtManifestPath), nuxtBinField)

interface Build {
  clientJs: string
  entryCss: string
  manifest: Record<string, { prefetch?: boolean; preload?: boolean; resourceType?: string }>
  /** The `@source "./ui/<component>.ts"` themes Nuxt UI generated. */
  themes: string[]
}

function build(name: string, env: Record<string, string>): Promise<Build> {
  const outDir = `.output/${name}`
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nuxtBin, 'build'], {
      cwd: fixtureRoot,
      env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1', FIXTURE_OUT_DIR: outDir, ...env },
    })
    let log = ''
    child.stdout.on('data', (chunk: Buffer) => (log += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (log += chunk.toString()))
    child.on('error', reject)
    child.on('exit', async (code) => {
      if (code !== 0) return reject(new Error(`nuxt build ${name} exited ${code}\n${log}`))
      try {
        const publicNuxt = join(fixtureRoot, outDir, 'output/public/_nuxt')
        const files = readdirSync(publicNuxt)
        const cssFile = files.find((file) => /^entry\..+\.css$/.test(file))
        if (!cssFile) throw new Error(`no entry stylesheet in ${publicNuxt}`)
        const manifestModule = (await import(
          pathToFileURL(join(fixtureRoot, outDir, 'nuxt/dist/server/client.manifest.mjs')).href
        )) as { default: Build['manifest'] }
        resolve({
          themes: [
            ...readFileSync(join(fixtureRoot, outDir, 'nuxt/ui.css'), 'utf8').matchAll(
              /@source "\.\/ui\/([a-z-]+)\.ts"/g,
            ),
          ].map((match) => match[1]!),
          entryCss: readFileSync(join(publicNuxt, cssFile), 'utf8'),
          manifest: manifestModule.default,
          clientJs: files
            .filter((file) => file.endsWith('.js'))
            .map((file) => readFileSync(join(publicNuxt, file), 'utf8'))
            .join('\n'),
        })
      } catch (error) {
        reject(error as Error)
      }
    })
  })
}

let defaults: Build
let optedOut: Build
let withApp: Build

beforeAll(async () => {
  ;[defaults, optedOut, withApp] = await Promise.all([
    build('default', {}),
    build('off', { FIXTURE_PERFORMANCE: 'off' }),
    build('app', { FIXTURE_APP: '1' }),
  ])
}, 300_000)

afterAll(() => {
  rmSync(join(fixtureRoot, '.output'), { force: true, recursive: true })
})

describe('performance defaults in a built consumer (narduk-libs#1369)', () => {
  it('writes no prefetch and no script preload into the manifest', () => {
    const entries = Object.values(defaults.manifest)
    const scripts = entries.filter((entry) => entry.resourceType === 'script')
    expect(scripts.length).toBeGreaterThan(5)
    expect(entries.every((entry) => entry.prefetch === false)).toBe(true)
    expect(scripts.every((entry) => entry.preload === false)).toBe(true)
  })

  it('keeps the stylesheet preload, which is not a script hint', () => {
    const styles = Object.values(defaults.manifest).filter((e) => e.resourceType === 'style')
    expect(styles.length).toBeGreaterThan(0)
    expect(styles.every((entry) => entry.preload === true)).toBe(true)
  })

  it('shrinks the entry stylesheet and leaves it valid CSS', () => {
    const { entryCss } = defaults
    expect(entryCss.length).toBeLessThan(optedOut.entryCss.length * 0.5)
    expect(entryCss).toContain('--ui-radius')
    expect(entryCss.split('{').length).toBe(entryCss.split('}').length)
    expect(defaults.themes).toEqual(expect.arrayContaining(['button', 'card']))
    expect(defaults.themes).not.toContain('accordion')
    // Detection off: Nuxt UI lists no per-component themes and ships them all.
    expect(optedOut.themes).toEqual([])
  })

  it('prefetches a link on interaction, not visibility', () => {
    expect(defaults.clientJs).toContain('prefetchOn:{visibility:!1,interaction:!0}')
  })

  it("keeps core's own components in the detected set when its app surface is on", () => {
    expect(defaults.themes).not.toContain('dashboard-sidebar')
    expect(withApp.themes).toEqual(expect.arrayContaining(['dashboard-sidebar', 'breadcrumb']))
  })

  it('opts out of all three with the module option', () => {
    const entries = Object.values(optedOut.manifest)
    expect(entries.some((entry) => entry.prefetch === true)).toBe(true)
    expect(entries.some((entry) => entry.resourceType === 'script' && entry.preload === true)).toBe(
      true,
    )
    expect(optedOut.clientJs).toContain('prefetchOn:{visibility:!0}')
  })
})
