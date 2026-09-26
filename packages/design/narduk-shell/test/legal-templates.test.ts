/*
 * The legal-page templates (narduk-libs#388). Logan's decision on the issue
 * was "Build, wording later": the mechanism ships, the wording does not. So
 * what these tests pin is that EVERY body the templates produce is a marked
 * placeholder, that an app's own inputs only ever land inside one, and that
 * the detection helpers an app can put in its own CI find them.
 */
import { describe, expect, it } from 'vitest'

import {
  hasLegalPlaceholders,
  isLegalPlaceholder,
  legalPlaceholder,
  NE_LEGAL_PLACEHOLDER_MARK,
  privacyPolicyTemplate,
  termsOfServiceTemplate,
  type NeLegalDocument,
  type NeLegalTemplateOptions,
} from '../src/index'

const OPTIONS: NeLegalTemplateOptions = {
  appName: 'Buoys',
  companyName: 'Example Co',
  contactEmail: 'privacy@example.test',
  processors: [
    { name: 'Cloudflare Web Analytics', purpose: 'analytics' },
    { name: 'Example Auth', purpose: 'sign-in' },
  ],
}

function paragraphs(document: NeLegalDocument): string[] {
  return document.sections.flatMap((section) =>
    typeof section.body === 'string' ? [section.body] : [...section.body],
  )
}

describe('legalPlaceholder', () => {
  it('wraps an instruction in the unmistakable placeholder mark', () => {
    const text = legalPlaceholder('describe what data is collected')
    expect(text.startsWith(NE_LEGAL_PLACEHOLDER_MARK)).toBe(true)
    expect(text).toContain('describe what data is collected')
    expect(text.endsWith(']')).toBe(true)
  })
})

describe.each([
  ['privacyPolicyTemplate', privacyPolicyTemplate],
  ['termsOfServiceTemplate', termsOfServiceTemplate],
] as const)('%s', (_name, template) => {
  const document = template(OPTIONS)

  it('returns a titled document with sections that have unique, anchor-safe ids', () => {
    expect(document.title.length).toBeGreaterThan(0)
    expect(document.sections.length).toBeGreaterThan(2)
    const ids = document.sections.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('writes no real legal wording: every paragraph is a marked placeholder', () => {
    for (const paragraph of paragraphs(document)) {
      expect(paragraph.startsWith(NE_LEGAL_PLACEHOLDER_MARK), paragraph).toBe(true)
    }
    for (const section of document.sections) {
      expect(section.placeholder).toBe(true)
      expect(isLegalPlaceholder(section)).toBe(true)
    }
    expect(hasLegalPlaceholders(document)).toBe(true)
  })

  it('puts the app inputs only inside placeholder paragraphs', () => {
    const text = paragraphs(document).join('\n')
    expect(text).toContain('Buoys')
    expect(text).toContain('Example Co')
    expect(text).toContain('privacy@example.test')
    // Section titles are structure, never a place for an app's inputs.
    for (const section of document.sections) {
      expect(section.title).not.toContain('Buoys')
      expect(section.title).not.toContain('Example Co')
    }
  })
})

describe('privacyPolicyTemplate processors', () => {
  it('lists each processor in its own placeholder', () => {
    const text = paragraphs(privacyPolicyTemplate(OPTIONS))
    const analytics = text.filter((paragraph) => paragraph.includes('Cloudflare Web Analytics'))
    const auth = text.filter((paragraph) => paragraph.includes('Example Auth'))
    expect(analytics).toHaveLength(1)
    expect(analytics[0]).toContain('analytics')
    expect(auth).toHaveLength(1)
    expect(auth[0]).toContain('sign-in')
  })

  it('still asks for the processors section when the app names none', () => {
    const document = privacyPolicyTemplate({ ...OPTIONS, processors: [] })
    expect(document.sections.some((section) => section.id === 'processors')).toBe(true)
    expect(hasLegalPlaceholders(document)).toBe(true)
  })
})

describe('hasLegalPlaceholders', () => {
  it('is false only for sections an app wrote itself', () => {
    const approved = [{ body: 'Approved text supplied by the app.', id: 'a', title: 'A' }]
    expect(hasLegalPlaceholders(approved)).toBe(false)
    expect(hasLegalPlaceholders({ sections: approved, title: 'T' })).toBe(false)
  })

  it('finds a placeholder by flag or by the mark in any paragraph', () => {
    expect(hasLegalPlaceholders([{ body: 'x', id: 'a', placeholder: true, title: 'A' }])).toBe(true)
    expect(
      hasLegalPlaceholders([
        { body: ['Fine.', legalPlaceholder('still to do')], id: 'a', title: 'A' },
      ]),
    ).toBe(true)
  })
})
