import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ogBrandArtSvg,
  ogBrandLayout,
  ogBrandPattern,
  ogBrandPlan,
  ogContrast,
  ogMonogram,
  ogReadable,
  ogTitleSize,
} from '../app/utils/ogBrandCard'
import { resolveSeoOgImageDefinition } from '../app/utils/ogImageDefinition'
import { brandHeadTags, brandMonogram, readBrandFile } from '../shared/brand'

const BRAND = {
  schemaVersion: 1,
  name: 'City of Edgerton',
  tagline: 'Plans, permits and the meeting calendar.',
  colors: { primary: '#1D4E89', accent: '#ff8a5b', ink: '#0b1626', paper: '#f2f5f8' },
  og: { layout: 'stamp', pattern: 'dots' },
}
const PALETTE = { primary: '#1d4e89', accent: '#ff8a5b', ink: '#0b1626', paper: '#f2f5f8' }

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'narduk-seo-brand-'))
  mkdirSync(join(root, 'Config'))
  mkdirSync(join(root, 'public'))
})
afterEach(() => rmSync(root, { force: true, recursive: true }))

function writeBrand(value: unknown): void {
  writeFileSync(join(root, 'Config/brand.json'), JSON.stringify(value))
}

describe('Config/brand.json', () => {
  it('is optional', () => {
    expect(readBrandFile(root, join(root, 'public'))).toBeNull()
  })

  it('reads colours, layout, pattern, monogram and the icon', () => {
    writeBrand(BRAND)
    writeFileSync(join(root, 'public/icon-512.png'), 'png')
    expect(readBrandFile(root, join(root, 'public'))).toEqual({
      name: 'City of Edgerton',
      tagline: 'Plans, permits and the meeting calendar.',
      primary: '#1d4e89',
      accent: '#ff8a5b',
      ink: '#0b1626',
      paper: '#f2f5f8',
      themeColor: '#1d4e89',
      layout: 'stamp',
      pattern: 'dots',
      monogram: 'CE',
      logo: '/icon-512.png',
    })
  })

  it('fails the build on a broken brand file', () => {
    writeFileSync(join(root, 'Config/brand.json'), '{')
    expect(() => readBrandFile(root, join(root, 'public'))).toThrow(/is not JSON/u)
    writeBrand({ ...BRAND, colors: { ...BRAND.colors, ink: 'navy' } })
    expect(() => readBrandFile(root, join(root, 'public'))).toThrow(/colors.ink must be/u)
    writeBrand({ ...BRAND, name: ' ' })
    expect(() => readBrandFile(root, join(root, 'public'))).toThrow(/needs a name/u)
  })

  it('derives a monogram the way narduk-app does', () => {
    expect(brandMonogram('The Newton Broadband Map')).toBe('NB')
    expect(brandMonogram('greenhills')).toBe('G')
    expect(brandMonogram('Anything', 'xyzw')).toBe('xyz')
  })
})

describe('icon head tags', () => {
  it('links only the files public/ has, and theme-color per scheme', () => {
    writeBrand(BRAND)
    const publicDir = join(root, 'public')
    for (const file of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest'])
      writeFileSync(join(publicDir, file), 'x')
    const tags = brandHeadTags(publicDir, readBrandFile(root, publicDir))
    expect(tags.link).toEqual([
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
      { rel: 'manifest', href: '/site.webmanifest' },
    ])
    expect(tags.meta).toEqual([
      { name: 'theme-color', content: '#1d4e89', media: '(prefers-color-scheme: light)' },
      { name: 'theme-color', content: '#0b1626', media: '(prefers-color-scheme: dark)' },
    ])
  })

  it('emits nothing for an app with no icons and no brand', () => {
    expect(brandHeadTags(join(root, 'public'), null)).toEqual({ link: [], meta: [] })
  })
})

describe('runtime brand card', () => {
  it('keeps every layout and pattern, and a page image forces the split panel', () => {
    expect(ogBrandLayout('ledger')).toBe('ledger')
    expect(ogBrandLayout('gradient')).toBe('poster')
    expect(ogBrandLayout('poster', true)).toBe('split')
    expect(ogBrandPattern('contours')).toBe('contours')
    expect(ogBrandPattern(undefined)).toBe('grid')
  })

  it('draws a distinct background per layout, with no generic gradient', () => {
    const arts = (['poster', 'split', 'stamp', 'ledger'] as const).map((layout) =>
      ogBrandArtSvg(layout, 'contours', PALETTE),
    )
    expect(new Set(arts).size).toBe(4)
    for (const art of arts) {
      expect(art).toContain(PALETTE.primary)
      expect(art).toMatch(/^<svg [^>]*width="1200" height="630"/u)
    }
    expect(ogBrandArtSvg('poster', 'none', PALETTE)).not.toContain('<pattern')
  })

  it('puts readable text on every field', () => {
    for (const layout of ['poster', 'split', 'stamp', 'ledger'] as const) {
      const plan = ogBrandPlan(layout, PALETTE, { host: 'edgerton.nard.uk', siteName: 'Edgerton' })
      expect(ogContrast(plan.title.color, plan.background)).toBeGreaterThan(4.5)
      expect(ogContrast(plan.eyebrow.color, plan.background)).toBeGreaterThanOrEqual(3)
    }
    // A pale accent on paper falls back to ink.
    expect(ogReadable(PALETTE, PALETTE.paper, '#ffe9a8')).toBe(PALETTE.ink)
  })

  it('sizes the title down as it grows and names the mark', () => {
    expect(ogTitleSize('Edgerton', 'poster')).toBeGreaterThan(
      ogTitleSize('A much longer page title that needs three full lines', 'poster'),
    )
    expect(ogTitleSize('x'.repeat(200), 'ledger')).toBe(56)
    expect(ogMonogram('', 'newton county broadband')).toBe('NC')
    expect(ogMonogram('E', 'Edgerton')).toBe('E')
  })

  it('passes the brand to the card, with per-call layout winning', () => {
    const brand = {
      name: 'City of Edgerton',
      ink: '#0b1626',
      paper: '#f2f5f8',
      layout: 'stamp' as const,
      pattern: 'dots' as const,
      monogram: 'CE',
      logo: '/icon-512.png',
    }
    const base = { title: 'Permits', description: 'Apply online', type: 'website' as const }
    expect(resolveSeoOgImageDefinition({ ...base, brand })?.props).toMatchObject({
      siteName: 'City of Edgerton',
      inkColor: '#0b1626',
      paperColor: '#f2f5f8',
      layout: 'stamp',
      pattern: 'dots',
      monogram: 'CE',
      logo: '/icon-512.png',
    })
    expect(
      resolveSeoOgImageDefinition({ ...base, brand, ogImage: { layout: 'ledger' } })?.props.layout,
    ).toBe('ledger')
    expect(resolveSeoOgImageDefinition(base)?.props).not.toHaveProperty('layout')
  })
})
