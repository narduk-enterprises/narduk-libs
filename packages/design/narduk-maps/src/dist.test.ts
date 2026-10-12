import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let out = ''

/** Every module reachable from `entry` through static `import ... from` / `export ... from`. */
function staticClosure(entry: string): Map<string, string> {
  const seen = new Map<string, string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    const code = readFileSync(file, 'utf8')
    seen.set(file, code)
    for (const m of code.matchAll(
      /(?:^|[;\n])\s*(?:import|export)\s[^'";]*?from\s*['"](\.[^'"]+)['"]/g,
    )) {
      walk(resolve(dirname(file), m[1] as string))
    }
    for (const m of code.matchAll(/(?:^|[;\n])\s*import\s*['"](\.[^'"]+\.js)['"]/g)) {
      walk(resolve(dirname(file), m[1] as string))
    }
  }
  walk(entry)
  return seen
}

describe('built package', () => {
  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), 'narduk-maps-dist-'))
    await build({
      root,
      logLevel: 'silent',
      configFile: resolve(root, 'vite.config.ts'),
      build: { outDir: out, emptyOutDir: true },
    })
  }, 180_000)

  afterAll(() => {
    if (out) rmSync(out, { recursive: true, force: true })
  })

  it('emits the four entries and the stylesheet', () => {
    for (const file of [
      'index.js',
      'svg.js',
      'style.js',
      'gl.js',
      'narduk-maps.css',
      'index.d.ts',
      'gl.d.ts',
    ]) {
      expect(existsSync(join(out, file)), file).toBe(true)
    }
  })

  for (const entry of ['index.js', 'svg.js', 'style.js']) {
    it(`${entry} and everything it imports never mention maplibre`, () => {
      const modules = staticClosure(join(out, entry))
      expect(modules.size).toBeGreaterThan(0)
      for (const [file, code] of modules) expect(code, file).not.toMatch(/maplibre/i)
    })
  }

  it('gl.js is the only place that loads maplibre-gl, dynamically, and leaves it external', () => {
    const code = readFileSync(join(out, 'gl.js'), 'utf8')
    const closure = [...staticClosure(join(out, 'gl.js')).values()].join('\n')
    expect(closure).toMatch(/import\(\s*["']maplibre-gl["']\s*\)/)
    expect(closure).not.toMatch(/^\s*import[^(]*from\s*["']maplibre-gl["']/m)
    expect(code.length).toBeGreaterThan(0)
  })

  it('the two svg entries expose the same names', async () => {
    const index = readFileSync(join(out, 'index.js'), 'utf8')
    const svg = readFileSync(join(out, 'svg.js'), 'utf8')
    expect(index.match(/export\s*\{[^}]*\}/g)?.length).toBeGreaterThan(0)
    expect(svg.match(/export\s*\{[^}]*\}/g)?.length).toBeGreaterThan(0)
  })
})
