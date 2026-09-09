import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'create-narduk-cli space #'))
const output = join(scratch, 'dist')
const cli = join(output, 'cli.js')
const alias = join(scratch, 'bin alias')

beforeAll(() => {
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ type: 'module' }))
  execFileSync(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '--project',
    join(packageRoot, 'tsconfig.json'),
    '--outDir',
    output,
  ])
  symlinkSync(output, alias, 'dir')
}, 30_000)

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('compiled CLI entrypoint', () => {
  it.each([cli, join(alias, 'cli.js')])('prints help through %s', (entrypoint) => {
    const result = spawnSync(process.execPath, [entrypoint, '--help'], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Usage: create-narduk-app')
  })

  it('generates an app when invoked through a symlinked directory', () => {
    const target = join(scratch, 'generated-app')
    const result = spawnSync(
      process.execPath,
      [join(alias, 'cli.js'), 'alias-proof', '--target-dir', target, '--json'],
      { encoding: 'utf8' },
    )
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).appName).toBe('alias-proof')
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name).toBe('alias-proof')
  })

  it.each([{ argv: [] }, { argv: ['missing-entrypoint'] }])(
    'keeps imports inert with argv $argv',
    ({ argv }) => {
      const script = `await import(${JSON.stringify(pathToFileURL(cli).href)}); console.log('imported')`
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, ...argv], {
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toBe('imported\n')
      expect(result.stderr).toBe('')
    },
  )
})
