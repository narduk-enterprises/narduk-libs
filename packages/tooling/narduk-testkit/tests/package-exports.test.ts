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

  it('keeps the fixture server out of the root barrel', () => {
    const rootSource = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8')

    /*
     * `e2e/fixture-server` is imported from a Playwright CONFIG (or the `webServer` command it
     * names), which is evaluated before the runner exists. The barrel pulls in `e2e/fixtures.js`,
     * which calls `test.extend` at module scope, so importing it from a config file is a different
     * and worse failure than a missing export. It stays a subpath-only module.
     */
    expect(rootSource).not.toContain('./e2e/fixture-server')
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(Object.keys(packageJson.exports)).toContain('./e2e/fixture-server')
  })

  it('publishes the deterministic-capture and request-accounting helpers to the Playwright family', () => {
    const rootSource = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8')
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }

    for (const subpath of [
      './playwright/deterministic-capture',
      './playwright/request-accounting',
    ]) {
      expect(Object.keys(packageJson.exports)).toContain(subpath)
      expect(rootSource).toContain(`export * from '${subpath.replace('./', './')}.js'`)
    }
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
