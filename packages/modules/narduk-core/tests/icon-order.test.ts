import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CORE_CLIENT_BUNDLE_ICONS, iconSeedArrivedLate } from '../src/icon-order'

const ICON_MODULE = { meta: { name: '@nuxt/icon' } }

describe('the @nuxt/icon seed order (narduk-libs#467)', () => {
  it('is silent when narduk-core seeds before @nuxt/icon installs', () => {
    expect(iconSeedArrivedLate({ _installedModules: [], icon: {} })).toBeUndefined()
    expect(iconSeedArrivedLate({ icon: undefined })).toBeUndefined()
    expect(
      iconSeedArrivedLate({ _installedModules: [{ meta: { name: '@nuxt/ui' } }], icon: {} }),
    ).toBeUndefined()
  })

  it('warns when @nuxt/icon installed first with the Iconify API fallback on', () => {
    const warning = iconSeedArrivedLate({ _installedModules: [ICON_MODULE], icon: {} })
    expect(warning).toContain('api.iconify.design')
    expect(warning).toContain('narduk-libs#467')
    expect(iconSeedArrivedLate({ _installedModules: [ICON_MODULE] })).toBeDefined()
    expect(
      iconSeedArrivedLate({ _installedModules: [ICON_MODULE], icon: { fallbackToApi: true } }),
    ).toBeDefined()
  })

  it('is silent when the app set fallbackToApi: false itself', () => {
    expect(
      iconSeedArrivedLate({ _installedModules: [ICON_MODULE], icon: { fallbackToApi: false } }),
    ).toBeUndefined()
  })
})

describe('the seeded client bundle', () => {
  // The copy/share buttons' state icons paint on click, after hydration, so a
  // miss is a network fetch on the first interaction (narduk-libs#467).
  it.each(['AppCopyButton.vue', 'AppShareButtons.vue'])('holds the icons %s swaps in', (file) => {
    const source = readFileSync(join(__dirname, '../runtime/app/components/shared', file), 'utf8')
    const icons = [...source.matchAll(/i-lucide-(check|copy|link)\b/g)].map(
      (match) => `lucide:${match[1]}`,
    )
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) expect(CORE_CLIENT_BUNDLE_ICONS).toContain(icon)
  })
})
