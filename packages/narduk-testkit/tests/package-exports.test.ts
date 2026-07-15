import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('narduk-testkit runner boundaries', () => {
  it('keeps the root export in the Playwright runner family', () => {
    const rootSource = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8')

    expect(rootSource).toContain("export * from './e2e/fixtures.js'")
    expect(rootSource).not.toContain("export * from './server/kit/")
  })

  it('publishes every Vitest helper only through an explicit server-kit subpath', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }

    expect(
      Object.keys(packageJson.exports).filter((subpath) => subpath.startsWith('./server/kit/')),
    ).toMatchInlineSnapshot(`
        [
          "./server/kit/smoke",
          "./server/kit/canonical-host",
          "./server/kit/auth-session-refresh",
          "./server/kit/auth-session-stability",
          "./server/kit/managed-supabase",
        ]
      `)
  })
})
