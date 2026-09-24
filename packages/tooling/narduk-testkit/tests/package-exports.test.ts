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

  it('publishes hydration-mismatch for vite.define without pulling Playwright', () => {
    const source = readFileSync(join(packageRoot, 'src/e2e/hydration-mismatch.ts'), 'utf8')
    const fixtures = readFileSync(join(packageRoot, 'src/e2e/fixtures.ts'), 'utf8')

    /*
     * nuxt.config / vite.config must be able to spread the E2E-only Vue define
     * without importing `e2e/fixtures`, which calls `test.extend` at module
     * scope. The helper file is therefore a subpath with no Playwright import.
     */
    expect(source).not.toMatch(/from ['"]@playwright\/test['"]/)
    expect(fixtures).toContain("from './hydration-mismatch.js'")
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(Object.keys(packageJson.exports)).toContain('./e2e/hydration-mismatch')
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

  it('keeps the dev-port helper out of the root barrel', () => {
    const rootSource = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8')

    /*
     * Same boundary as `e2e/fixture-server` above, and for the same reason:
     * `playwright/dev-port` is imported from a Playwright CONFIG, evaluated
     * before the runner exists. Re-exporting it from the barrel would drag
     * `e2e/fixtures.js` and its module-scope `test.extend` into config load.
     */
    expect(rootSource).not.toContain('./playwright/dev-port')
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(Object.keys(packageJson.exports)).toContain('./playwright/dev-port')
  })

  it('publishes the pr/web Playwright preset for config load, without the root barrel', () => {
    const rootSource = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8')
    const source = readFileSync(join(packageRoot, 'src/playwright/config.ts'), 'utf8')
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, Record<string, string>>
    }

    expect(rootSource).not.toContain('./playwright/config')
    const quarantine = readFileSync(join(packageRoot, 'src/playwright/quarantine.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"]@playwright\/test['"]/)
    expect(source).not.toMatch(/from ['"].*e2e\/fixtures['"]/)
    expect(quarantine).not.toMatch(/from ['"]@playwright\/test['"]/)
    expect(quarantine).not.toMatch(/from ['"].*e2e\/fixtures['"]/)
    expect(Object.keys(packageJson.exports)).toContain('./playwright/config')
    const config = packageJson.exports['./playwright/config']
    expect(config.require).toBe('./dist/playwright/config.js')
    expect(config.require).toBe(config.import)
  })

  it('lets the dev-port helper be required, because Playwright loads a config as CJS', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, Record<string, string>>
    }

    /*
     * Playwright transpiles a TypeScript config to CJS unless the consumer says
     * otherwise (`--import tsx`, `"type": "module"`), so an `import` of this
     * subpath becomes a `require`. Without a `require` condition that fails with
     * ERR_PACKAGE_PATH_NOT_EXPORTED before a single line runs -- which is
     * exactly how narduk-libs#417's first attempt died in packed-consumer-smoke.
     * Node >= 22 requires an ESM file with no top-level await, so both
     * conditions point at the same build output.
     */
    const devPort = packageJson.exports['./playwright/dev-port']
    expect(devPort.require).toBe('./dist/playwright/dev-port.js')
    expect(devPort.require).toBe(devPort.import)
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
