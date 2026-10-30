import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { lucideIconsIn } from '../src/icon-bundle'

describe('lucideIconsIn', () => {
  it('finds class, attribute and prefixed spellings in .vue and .ts, and skips node_modules and .d.ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ne-icons-'))
    mkdirSync(join(dir, 'components'))
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(
      join(dir, 'components', 'A.vue'),
      '<UIcon name="i-lucide-arrow-up-down" /><i class="i-lucide-x" />',
    )
    writeFileSync(join(dir, 'b.ts'), "export const glyph = 'lucide:chevrons-up'")
    writeFileSync(join(dir, 'c.d.ts'), "type T = 'lucide:ignored-declaration'")
    writeFileSync(join(dir, 'node_modules', 'd.ts'), "export const d = 'lucide:ignored-dependency'")
    expect([...lucideIconsIn(dir)].sort()).toEqual([
      'lucide:arrow-up-down',
      'lucide:chevrons-up',
      'lucide:x',
    ])
  })

  it("covers the icons of this package's own runtime, NeSortHeader's included", () => {
    const icons = lucideIconsIn(join(import.meta.dirname, '..', 'src', 'runtime'))
    expect(icons.has('lucide:arrow-up-down')).toBe(true)
  })
})

describe('narduk-shell module icon bundle', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('adds its runtime icons to the @nuxt/icon client bundle through icon:clientBundleIcons', async () => {
    vi.doMock('@nuxt/kit', () => ({
      addComponent: vi.fn(),
      addImports: vi.fn(),
      addPlugin: vi.fn(),
      createResolver: (url: string) => ({ resolve: (path: string) => new URL(path, url).pathname }),
      defineNuxtModule: (definition: unknown) => definition,
    }))
    const hook = vi.fn()
    const module_ = (await import('../src/module')).default as unknown as {
      setup: (options: object, nuxt: unknown) => Promise<void>
    }
    await module_.setup(
      { components: false },
      { hook, options: { build: { transpile: [] }, css: [], appConfig: {} } },
    )

    const call = hook.mock.calls.find(([name]) => name === 'icon:clientBundleIcons')
    expect(call, 'the module registered no icon:clientBundleIcons hook').toBeDefined()
    const icons = new Set<string>(['lucide:check'])
    ;(call![1] as (icons: Set<string>) => void)(icons)
    expect(icons.has('lucide:check')).toBe(true)
    expect(icons.has('lucide:arrow-up-down')).toBe(true)
  })
})
