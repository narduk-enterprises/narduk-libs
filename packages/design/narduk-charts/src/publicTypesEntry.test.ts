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
  let packDir: string | undefined

  afterEach(() => {
    if (packDir) rmSync(packDir, { force: true, recursive: true })
    packDir = undefined
  })

  it('packs a dist/index.d.ts that exports the public surface', () => {
    run('pnpm', ['exec', 'vite', 'build'], packageRoot)
    run('cp', ['dist/index.d.ts', 'dist/index.d.cts'], packageRoot)

    packDir = mkdtempSync(join(tmpdir(), 'narduk-charts-pack-'))
    run('pnpm', ['pack', '--pack-destination', packDir], packageRoot)
    const tarball = readdirSync(packDir).find(name => name.endsWith('.tgz'))
    expect(tarball).toBeTruthy()

    const packedTypes = execFileSync(
      'tar',
      ['-xOf', join(packDir, tarball!), 'package/dist/index.d.ts'],
      { encoding: 'utf8' },
    )
    const packedRequireTypes = execFileSync(
      'tar',
      ['-xOf', join(packDir, tarball!), 'package/dist/index.d.cts'],
      { encoding: 'utf8' },
    )

    for (const declaration of [packedTypes, packedRequireTypes]) {
      expect(declaration.trim()).not.toBe('export {}')
      expect(declaration).toContain('NardukLineChart')
      expect(declaration).toContain('ChartSeries')
    }

    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: { '.': { import: { types: string }; require: { types: string } } }
    }
    expect(packageJson.exports['.'].import.types).toBe('./dist/index.d.ts')
    expect(packageJson.exports['.'].require.types).toBe('./dist/index.d.cts')
  }, 180_000)
})
