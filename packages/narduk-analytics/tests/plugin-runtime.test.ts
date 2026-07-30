// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(__dirname, '..', 'app', 'plugins')

const pluginImports = [
  {
    file: '00-analytics-head.client.ts',
    required: ['defineNuxtPlugin', 'useHead', 'useRuntimeConfig'],
  },
  {
    file: 'gtag.client.ts',
    required: ['defineNuxtPlugin', 'nextTick', 'useRouter', 'useRuntimeConfig'],
  },
  {
    file: 'posthog.client.ts',
    required: ['defineNuxtPlugin', 'nextTick', 'useRouter', 'useRuntimeConfig'],
  },
] as const

describe('narduk-analytics shipped plugins', () => {
  it.each(pluginImports)(
    '$file explicitly imports its Nuxt runtime dependencies',
    ({ file, required }) => {
      const source = readFileSync(join(pluginRoot, file), 'utf8')
      const imports = source.match(/import\s*\{([\s\S]*?)\}\s*from\s*['"]#imports['"]/u)?.[1]

      expect(imports, `${file} must import from #imports`).toBeDefined()
      for (const name of required) {
        expect(imports).toMatch(new RegExp(`\\b${name}\\b`, 'u'))
      }
    },
  )

  it('executes every shipped plugin entrypoint without relying on ambient auto-import globals', async () => {
    const plugins = await Promise.all([
      import('../app/plugins/00-analytics-head.client'),
      import('../app/plugins/gtag.client'),
      import('../app/plugins/posthog.client'),
    ])

    expect(plugins.map((plugin) => plugin.default.name)).toEqual([
      'analytics-head',
      'gtag',
      'posthog',
    ])

    for (const plugin of plugins) {
      expect(() => plugin.default.setup?.({ provide: vi.fn() })).not.toThrow()
    }
  })
})
