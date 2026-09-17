import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')

describe('narduk-analytics package exports', () => {
  it('exports the module and analytics runtime surface', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./nuxt']).toEqual({
      import: './src/module.ts',
    })
    expect(packageJson.exports['./app/plugins/*']).toEqual({
      import: './app/plugins/*.ts',
    })
    expect(packageJson.exports['./app/types/adminPosthogDashboardTypes']).toEqual({
      types: './app/types/adminPosthogDashboardTypes.ts',
      import: './app/types/adminPosthogDashboardTypes.ts',
      default: './app/types/adminPosthogDashboardTypes.ts',
    })
  })

  it('value-imports adminPosthogDashboardTypes through the package name', async () => {
    // Built at runtime so Vite does not fail the whole file at collect time
    // when the exact export key is still types-only.
    const specifier = [
      '@narduk-enterprises',
      'narduk-analytics',
      'app/types/adminPosthogDashboardTypes',
    ].join('/')
    const mod = (await import(specifier)) as { adminPosthogPagesApi: string }
    expect(mod.adminPosthogPagesApi).toBe('/api/admin/posthog/pages')
  })
})
