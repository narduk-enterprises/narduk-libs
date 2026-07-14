import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')

describe('narduk-seo package exports', () => {
  it('exports the module and SEO runtime surface', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./nuxt']).toEqual({
      import: './src/module.ts',
    })
    expect(packageJson.exports['./app/composables/*']).toEqual({
      import: './app/composables/*.ts',
    })
  })

  it('ships immutable OG image renderer dependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
      overrides?: Record<string, string>
    }

    expect(packageJson.dependencies['nuxt-og-image']).toBe('6.7.2')
    expect(packageJson.dependencies['@takumi-rs/core']).toBe('2.2.0')
    expect(packageJson.dependencies['@takumi-rs/wasm']).toBe('2.2.0')
    expect(packageJson.overrides).not.toHaveProperty('@takumi-rs/core')
    expect(packageJson.overrides).not.toHaveProperty('@takumi-rs/wasm')
  })

  it('keeps the packaged network page independent of consumer auto-import transforms', () => {
    const page = readFileSync(join(packageRoot, 'app/pages/narduk-network.vue'), 'utf-8')

    expect(page).toContain(
      "import { resolveSiteOriginForSchemaInput } from '../utils/resolveSiteOriginForSchema'",
    )
  })
})
