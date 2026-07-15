import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolvePnpmInvocation, spawnPnpmSync } from '../src/package-manager.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('package-manager invocation', () => {
  it('uses npm_execpath through Node when PATH cannot resolve pnpm', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-pnpm-invocation-'))
    tempDirs.push(root)
    const packageManagerEntrypoint = join(root, 'pnpm.cjs')
    writeFileSync(
      packageManagerEntrypoint,
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
    )

    const env = { npm_execpath: packageManagerEntrypoint, PATH: '' }
    expect(resolvePnpmInvocation(env)).toEqual({
      argsPrefix: [packageManagerEntrypoint],
      command: process.execPath,
    })

    for (const invocation of ['first', 'second']) {
      const result = spawnPnpmSync(['exec', 'wrangler', invocation], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(['exec', 'wrangler', invocation])
    }
  })
})
