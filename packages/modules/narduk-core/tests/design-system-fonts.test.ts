import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DESIGN_SYSTEM_FONT_FAMILIES,
  DESIGN_SYSTEM_STYLESHEETS,
  loadsDesignSystemFonts,
  seedDesignSystemFonts,
} from '../src/design-system-fonts'

const PLEX_MONO = 'IBM Plex Mono'
const INSTRUMENT_SANS = 'Instrument Sans'
const TOKENS = '@narduk-enterprises/narduk-ui/tokens.css'
const SHELL_THEME = '@narduk-enterprises/narduk-shell/theme.css'
const designDir = join(__dirname, '../../../design')

describe('the design-system font declaration (narduk-libs#1366)', () => {
  it('declares both families global, so @nuxt/fonts emits them from a var() it cannot trace', () => {
    expect(DESIGN_SYSTEM_FONT_FAMILIES.map((family) => family.name)).toEqual([
      INSTRUMENT_SANS,
      PLEX_MONO,
    ])
    for (const family of DESIGN_SYSTEM_FONT_FAMILIES) {
      expect(family.global).toBe(true)
      expect(family.provider).toBe('google')
      expect(family.styles).toEqual(['normal'])
    }
  })

  it('keeps the weights the retired Google Fonts request asked for', () => {
    const weights = Object.fromEntries(
      DESIGN_SYSTEM_FONT_FAMILIES.map((family) => [family.name, family.weights]),
    )
    expect(weights[INSTRUMENT_SANS]).toEqual([400, 500, 600, 700])
    expect(weights[PLEX_MONO]).toEqual([400, 500, 600])
  })

  it('names the families the design system stylesheets actually set', () => {
    const tokens = readFileSync(join(designDir, 'narduk-ui/tokens.css'), 'utf8')
    const theme = readFileSync(join(designDir, 'narduk-shell/theme.css'), 'utf8')
    for (const family of DESIGN_SYSTEM_FONT_FAMILIES) {
      expect(tokens).toMatch(new RegExp(`--ns-font-(text|mono):\\s*["']${family.name}["']`))
      expect(theme).toMatch(new RegExp(`--ne-font-(sans|mono):\\s*["']${family.name}["']`))
    }
  })

  it('lists the stylesheets as the specifiers the packages export', () => {
    expect([...DESIGN_SYSTEM_STYLESHEETS]).toEqual([TOKENS, SHELL_THEME])
  })
})

describe('seedDesignSystemFonts', () => {
  it('seeds both families for an app that loads the narduk-ui tokens', () => {
    const options: { css: string[]; fonts?: unknown } = { css: [TOKENS, './app/theme.css'] }
    expect(seedDesignSystemFonts(options)).toEqual([INSTRUMENT_SANS, PLEX_MONO])
    expect(options.fonts).toEqual({
      families: [
        {
          name: INSTRUMENT_SANS,
          provider: 'google',
          weights: [400, 500, 600, 700],
          styles: ['normal'],
          global: true,
        },
        {
          name: PLEX_MONO,
          provider: 'google',
          weights: [400, 500, 600],
          styles: ['normal'],
          global: true,
        },
      ],
    })
  })

  it('seeds for the shell theme stylesheet and for the shell module with its theme on', () => {
    expect(loadsDesignSystemFonts({ css: [SHELL_THEME] })).toBe(true)
    expect(loadsDesignSystemFonts({ modules: ['@narduk-enterprises/narduk-shell'] })).toBe(true)
    expect(
      loadsDesignSystemFonts({
        modules: [['@narduk-enterprises/narduk-shell', { accent: 'red' }]],
      }),
    ).toBe(true)
  })

  it('leaves an app alone that loads no design-system stylesheet', () => {
    const options: { css: string[]; fonts?: unknown; modules: unknown[] } = {
      css: ['./app/main.css'],
      modules: ['@nuxt/ui'],
    }
    expect(seedDesignSystemFonts(options)).toEqual([])
    expect(options.fonts).toBeUndefined()
  })

  it('leaves an app alone that turned the shell theme off', () => {
    const options = { modules: [['@narduk-enterprises/narduk-shell', { theme: false }]] }
    expect(seedDesignSystemFonts(options)).toEqual([])
    expect((options as { fonts?: unknown }).fonts).toBeUndefined()
  })

  it('lets an app entry win by name, including an opt-out and a narrower weight list', () => {
    const options = {
      css: [TOKENS],
      fonts: {
        defaults: { subsets: ['latin'] },
        families: [
          { name: 'instrument sans', provider: 'none' },
          { name: 'Inter', provider: 'google' },
        ],
      },
    }
    expect(seedDesignSystemFonts(options)).toEqual([PLEX_MONO])
    expect(options.fonts.defaults).toEqual({ subsets: ['latin'] })
    expect(options.fonts.families.map((family) => family.name)).toEqual([
      'instrument sans',
      'Inter',
      PLEX_MONO,
    ])
    expect(options.fonts.families[0]).toEqual({ name: 'instrument sans', provider: 'none' })
  })

  it('is idempotent when the app already declares both families', () => {
    const options = {
      css: [TOKENS],
      fonts: { families: [{ name: INSTRUMENT_SANS }, { name: PLEX_MONO }] },
    }
    expect(seedDesignSystemFonts(options)).toEqual([])
    expect(options.fonts.families).toHaveLength(2)
  })

  it('does not share the frozen declaration with the app options', () => {
    const options: { css: string[]; fonts?: { families: Array<{ weights: number[] }> } } = {
      css: [TOKENS],
    }
    seedDesignSystemFonts(options)
    options.fonts!.families[0]!.weights.push(900)
    expect(DESIGN_SYSTEM_FONT_FAMILIES[0]!.weights).toEqual([400, 500, 600, 700])
  })
})

describe('the module wiring', () => {
  it('seeds before @nuxt/fonts installs, since the module reads its options once', () => {
    const source = readFileSync(join(__dirname, '../src/module.ts'), 'utf8')
    const seed = source.indexOf('seedDesignSystemFonts(nuxtOptions)')
    const install = source.indexOf("installModule('@nuxt/fonts')")
    expect(seed).toBeGreaterThan(0)
    expect(install).toBeGreaterThan(seed)
  })
})
