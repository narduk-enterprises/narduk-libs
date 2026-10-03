/**
 * narduk-libs#1379: the css-mode stylesheet scan leaves the hydration path.
 * These tests pin the patch against the `@nuxt/icon` copy narduk-core depends
 * on, so a version bump that moves the call site fails here instead of
 * silently putting the scan back.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  addIconCssScanPlugin,
  nardukIconCssScanPlugin,
  NUXT_ICON_CSS_RUNTIME,
  patchNuxtIconCssRuntime,
} from '../src/icon-css-scan'
import { nuxtIconModuleEntry } from '../src/nuxt-icon-module'

const cssRuntimePath = join(dirname(nuxtIconModuleEntry()), 'runtime/components/css.js')
const upstream = readFileSync(cssRuntimePath, 'utf8')

interface IconSelectors {
  add(selector: string): void
  has(selector: string): boolean
}

/** Evaluates the appended helper against a fake document of inline styles. */
function helperWith(styles: string[] | undefined): IconSelectors {
  const patched = patchNuxtIconCssRuntime(upstream) as string
  const tail = patched.slice(patched.indexOf('// narduk-libs#1379'))
  const document =
    styles === undefined
      ? undefined
      : { querySelectorAll: () => styles.map((textContent) => ({ textContent })) }
  return new Function('document', `${tail}\nreturn nardukInlineIconSelectors()`)(
    document,
  ) as IconSelectors
}

describe('the icon css-scan patch (narduk-libs#1379)', () => {
  it('matches the installed @nuxt/icon css runtime, which still scans the stylesheets', () => {
    expect(NUXT_ICON_CSS_RUNTIME.test(cssRuntimePath)).toBe(true)
    expect(upstream).toContain('const selectors = getAllSelectors();')
    expect(upstream).toContain('document.styleSheets')
  })

  it('replaces the one scan call site and nothing else', () => {
    const patched = patchNuxtIconCssRuntime(upstream) as string
    expect(patched).toBeDefined()
    expect(patched).not.toContain('const selectors = getAllSelectors();')
    expect(patched).toContain('const selectors = nardukInlineIconSelectors();')
    const kept = patched.slice(0, patched.indexOf('// narduk-libs#1379'))
    expect(kept.replace('nardukInlineIconSelectors', 'getAllSelectors').trim()).toBe(
      upstream.trim(),
    )
  })

  it('leaves unknown source alone so the upstream scan stays', () => {
    expect(patchNuxtIconCssRuntime('export const x = 1')).toBeUndefined()
    expect(
      patchNuxtIconCssRuntime(
        upstream.replace('const selectors = getAllSelectors();', 'const selectors = scan();'),
      ),
    ).toBeUndefined()
  })

  it('treats an icon rule in an inline style as present, without reading the CSSOM', () => {
    const selectors = helperWith([
      '@layer theme{:root{--a:1}}',
      ':where(.i-lucide\\:menu){display:inline-block}:where(.i-lucide\\:x){display:inline-block}',
    ])
    expect(selectors.has('.i-lucide\\:menu')).toBe(true)
    expect(selectors.has('.i-lucide\\:x')).toBe(true)
  })

  it('does not match a longer name that shares a prefix', () => {
    const selectors = helperWith([':where(.i-lucide\\:x-circle){display:inline-block}'])
    expect(selectors.has('.i-lucide\\:x')).toBe(false)
  })

  it('matches a rule written without :where() and one inside a layer', () => {
    const selectors = helperWith([
      '.i-lucide\\:sun{display:inline-block}',
      '@layer icons {:where(.i-lucide\\:moon){display:inline-block}}',
    ])
    expect(selectors.has('.i-lucide\\:sun')).toBe(true)
    expect(selectors.has('.i-lucide\\:moon')).toBe(true)
  })

  it('reports a missing icon as missing until the component mounts it', () => {
    const selectors = helperWith([':where(.i-lucide\\:menu){display:inline-block}'])
    expect(selectors.has('.i-lucide\\:search')).toBe(false)
    selectors.add('.i-lucide\\:search')
    expect(selectors.has('.i-lucide\\:search')).toBe(true)
  })

  it('is safe without a document', () => {
    expect(helperWith(undefined).has('.i-lucide\\:x')).toBe(false)
  })
})

describe('the icon css-scan vite plugin', () => {
  const transform = (plugin: ReturnType<typeof nardukIconCssScanPlugin>, id: string) =>
    plugin.transform.call({ warn: () => {} }, upstream, id)

  it('patches the css runtime and ignores every other module', () => {
    const plugin = nardukIconCssScanPlugin()
    expect(transform(plugin, cssRuntimePath)).toMatchObject({
      code: expect.stringContaining('nardukInlineIconSelectors'),
    })
    expect(transform(plugin, cssRuntimePath.replace('css.js', 'svg.js'))).toBeNull()
    expect(transform(plugin, '/app/components/Icon.vue')).toBeNull()
  })

  it('leaves the server build on upstream source', () => {
    const plugin = nardukIconCssScanPlugin()
    expect(
      plugin.transform.call({ warn: () => {} }, upstream, cssRuntimePath, { ssr: true }),
    ).toBeNull()
  })

  it('registers once on the app vite options', () => {
    const options: { vite?: { plugins?: unknown[] } } = {}
    addIconCssScanPlugin(options)
    addIconCssScanPlugin(options)
    expect(options.vite?.plugins).toHaveLength(1)
  })

  it('stands down under UnoCSS, which leaves icon rules in a linked stylesheet', () => {
    const plugin = nardukIconCssScanPlugin()
    plugin.configResolved({ plugins: [{ name: 'vite:css' }, { name: 'unocss:api' }] })
    expect(transform(plugin, cssRuntimePath)).toBeNull()
  })

  it('warns once and keeps the upstream scan when the source moved', () => {
    const warnings: string[] = []
    const plugin = nardukIconCssScanPlugin()
    const moved = upstream.replace(
      'const selectors = getAllSelectors();',
      'const selectors = scan();',
    )
    for (let i = 0; i < 2; i += 1) {
      expect(
        plugin.transform.call({ warn: (m) => warnings.push(m) }, moved, cssRuntimePath),
      ).toBeNull()
    }
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('narduk-libs#1379')
  })
})
