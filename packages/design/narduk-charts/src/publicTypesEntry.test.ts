import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--max-old-space-size=4096`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('published types entry', () => {
  let outDir: string | undefined

  afterEach(() => {
    if (outDir) rmSync(outDir, { force: true, recursive: true })
    outDir = undefined
  })

  // Builds into a temp outDir, never the package's own dist/: a build in place
  // empties dist/ and drops the subpath bundles check:package needs.
  it('emits a dist/index.d.ts that exports the public surface', () => {
    outDir = mkdtempSync(join(tmpdir(), 'narduk-charts-types-'))
    run('pnpm', ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'], packageRoot)

    const emitted = readdirSync(outDir)
    expect(emitted).toContain('index.d.ts')
    const declaration = readFileSync(join(outDir, 'index.d.ts'), 'utf8')
    expect(declaration.trim()).not.toBe('export {}')
    expect(declaration).toContain('NardukLineChart')
    expect(declaration).toContain('ChartSeries')

    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: { '.': { import: { types: string }; require: { types: string } } }
      scripts: Record<string, string>
    }
    expect(packageJson.exports['.'].import.types).toBe('./dist/index.d.ts')
    expect(packageJson.exports['.'].require.types).toBe('./dist/index.d.cts')
    // The require entry is a copy of the import entry made by build:only.
    expect(packageJson.scripts['build:only']).toContain('cp dist/index.d.ts dist/index.d.cts')
  }, 180_000)
})
