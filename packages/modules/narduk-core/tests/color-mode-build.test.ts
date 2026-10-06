/**
 * narduk-libs#1464, proved on real builds: the `colorMode.classSuffix: ''`
 * default reaches the page a consumer that states no `colorMode` ships, so the
 * document class is `dark` and not `dark-mode`, and an app's own suffix still
 * wins.
 *
 * `@nuxtjs/color-mode` reads `nuxt.options.colorMode` once, in its own setup,
 * so a default written after narduk-core installs it never reaches the page.
 * Reading the `colorMode` option in a unit test cannot see that, so this builds
 * `fixtures/color-mode-app` twice (the default, and an app that states
 * `classSuffix: '-mode'`), prerenders `/`, and reads the inline script the
 * module put in the built HTML.
 */
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/color-mode-app')
const require = createRequire(fileURLToPath(import.meta.url))
const nuxtManifestPath = require.resolve('nuxt/package.json')
const nuxtBinField = (
  JSON.parse(readFileSync(nuxtManifestPath, 'utf8')) as { bin?: { nuxt?: string } }
).bin?.nuxt
if (!nuxtBinField) throw new Error('nuxt package.json has no bin.nuxt')
const nuxtBin = join(dirname(nuxtManifestPath), nuxtBinField)

/** The prerendered `/` of a build of the fixture. */
function build(name: string, env: Record<string, string>): Promise<string> {
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
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`nuxt build ${name} exited ${code}\n${log}`))
      try {
        resolve(readFileSync(join(fixtureRoot, outDir, 'output/public/index.html'), 'utf8'))
      } catch (error) {
        reject(error as Error)
      }
    })
  })
}

/** The inline script `@nuxtjs/color-mode` puts in the head: the one that reads its storage key. */
function colorModeScript(html: string): string {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(
    (match) => match[1]!,
  )
  const script = scripts.find((body) => body.includes('nuxt-color-mode'))
  if (!script) throw new Error('the built page has no color-mode script')
  return script
}

let defaults: string
let overridden: string

beforeAll(async () => {
  ;[defaults, overridden] = await Promise.all([
    build('default', {}),
    build('override', { FIXTURE_CLASS_SUFFIX: '-mode' }),
  ])
}, 300_000)

afterAll(() => {
  rmSync(join(fixtureRoot, '.output'), { force: true, recursive: true })
})

describe('colorMode defaults in a built consumer (narduk-libs#1464)', () => {
  it('writes an empty class suffix into the page script, so the class is `dark`', () => {
    // The module builds the class as `<prefix><mode><suffix>`; here that is
    // `""+mode+""`, where the default suffix would read `""+mode+"-mode"`.
    const script = colorModeScript(defaults)
    expect(script).toMatch(/const \w+=""\+\w+\+""/)
    expect(script).not.toContain('"-mode"')
  })

  it('keeps an app-stated suffix, which still wins over the default', () => {
    expect(colorModeScript(overridden)).toMatch(/const \w+=""\+\w+\+"-mode"/)
  })
})
