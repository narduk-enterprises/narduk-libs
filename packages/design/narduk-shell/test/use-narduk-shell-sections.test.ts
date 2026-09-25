/*
 * `useNardukShellSections()` and the brand-override rule — components backlog
 * item 18 (narduk-libs#265).
 *
 * Under vitest, `#imports` is Nuxt UI's Vue-mode stubs: `useState` is a
 * module-level keyed store and `useAppConfig` a reactive `#build/app.config`,
 * so this file can play the part of Nuxt's runtime. The store is shared for
 * the whole file, so the seeding case runs first and the rest reset it.
 */
import { describe, expect, it } from 'vitest'

import { useAppConfig } from '#imports'

import type { NeAppShellSection } from '../src/runtime/components/ne-app-shell-types'
import {
  copySections,
  readShellAppConfig,
  useNardukShellSections,
} from '../src/runtime/composables/use-narduk-shell-sections'
import {
  safeBrandValue,
  SHELL_BRAND_SELECTOR,
  shellBrandCss,
} from '../src/runtime/utils/shell-brand'

const CONFIGURED: NeAppShellSection[] = [
  { id: 'operate', label: 'Operate', items: [{ label: 'Overview', to: '/' }] },
]

describe('useNardukShellSections', () => {
  it('seeds from app.config.nardukShell.sections, as a copy', () => {
    useAppConfig().nardukShell = { sections: CONFIGURED }
    const sections = useNardukShellSections()
    expect(sections.value).toEqual(CONFIGURED)

    sections.value[0]!.items.push({ label: 'Runners', to: '/runners' })
    sections.value.push({ id: 'admin', label: 'Admin', items: [] })
    expect(CONFIGURED).toEqual([
      { id: 'operate', label: 'Operate', items: [{ label: 'Overview', to: '/' }] },
    ])
  })

  it('returns the same shared ref to every caller', () => {
    const first = useNardukShellSections()
    first.value = [{ id: 'x', label: 'X', items: [] }]
    expect(useNardukShellSections()).toBe(first)
    expect(useNardukShellSections().value[0]!.id).toBe('x')
  })
})

describe('readShellAppConfig / copySections', () => {
  it('reads an absent or malformed key as empty', () => {
    expect(readShellAppConfig({})).toEqual({})
    expect(readShellAppConfig({ nardukShell: 'nope' })).toEqual({})
  })

  it('copies down to the item objects', () => {
    const copy = copySections(CONFIGURED)
    expect(copy).toEqual(CONFIGURED)
    expect(copy[0]).not.toBe(CONFIGURED[0])
    expect(copy[0]!.items[0]).not.toBe(CONFIGURED[0]!.items[0])
  })
})

describe('shellBrandCss', () => {
  it('is empty when neither token has a usable value', () => {
    expect(shellBrandCss(undefined)).toBe('')
    expect(shellBrandCss({})).toBe('')
    expect(shellBrandCss({ accent: '   ' })).toBe('')
  })

  it('declares the given tokens on the brand selector', () => {
    expect(shellBrandCss({ accent: ' #7c3aed ', structure: 'var(--brand-navy)' })).toBe(
      `${SHELL_BRAND_SELECTOR} { --ne-accent: #7c3aed; --ne-structure: var(--brand-navy); }`,
    )
  })

  it('accepts colour syntaxes and refuses anything that could leave the declaration', () => {
    for (const ok of [
      '#7c3aed',
      'oklch(0.6 0.2 290 / 80%)',
      'color-mix(in oklab, red, blue)',
      'teal',
    ]) {
      expect(safeBrandValue(ok)).toBe(ok)
    }
    for (const bad of [
      'red; } body { display: none',
      '</style><script>',
      'url("x")',
      'a\\62',
      42,
    ]) {
      expect(safeBrandValue(bad)).toBeUndefined()
    }
  })
})
