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
    expect(packageJson.exports['./shared/*']).toEqual({
      import: './shared/*.ts',
    })
  })

  it('ships immutable OG image renderer dependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
      overrides?: Record<string, string>
    }

    expect(packageJson.dependencies['nuxt-og-image']).toBe('6.8.0')
    expect(packageJson.dependencies['@takumi-rs/core']).toBe('2.2.0')
    expect(packageJson.dependencies['@takumi-rs/wasm']).toBe('2.2.0')
    expect(packageJson.overrides).not.toHaveProperty('@takumi-rs/core')
    expect(packageJson.overrides).not.toHaveProperty('@takumi-rs/wasm')
  })

  it('pins one coordinated Nuxt SEO module set (narduk-libs#316)', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
    }

    // These releases share one nuxtseo-shared/nuxt-site-config line and accept
    // both Unhead 2 (Nuxt 4.4) and Unhead 3 (Nuxt 4.5). Bump them together.
    expect(packageJson.dependencies).toMatchObject({
      '@nuxtjs/robots': '6.2.3',
      '@nuxtjs/sitemap': '8.5.1',
      'nuxt-link-checker': '5.3.0',
      'nuxt-og-image': '6.8.0',
      'nuxt-schema-org': '6.3.2',
      'nuxt-seo-utils': '8.5.1',
      'nuxt-site-config': '4.2.3',
    })
  })

  it('keeps the packaged network page independent of consumer auto-import transforms', () => {
    const page = readFileSync(join(packageRoot, 'app/pages/narduk-network.vue'), 'utf-8')

    expect(page).toContain(
      "import { resolveSiteOriginForSchemaInput } from '../utils/resolveSiteOriginForSchema'",
    )
  })
})
