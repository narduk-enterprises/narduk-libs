import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { FULL_PAGE_LOAD, signInLandingPath } from '../app/utils/fullPageLoad'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('sign-in ends in a full page load (D-HTML-CACHE-PUBLIC-1)', () => {
  it('uses an external, replacing navigation', () => {
    expect(FULL_PAGE_LOAD).toEqual({ external: true, replace: true })
  })

  it('keeps a same-origin server redirect and refuses everything else', () => {
    expect(signInLandingPath('/app?x=1#y', '/dashboard/')).toBe('/app?x=1#y')
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil', 'app', undefined, 7]) {
      expect(signInLandingPath(bad, '/dashboard/')).toBe('/dashboard/')
    }
  })

  // The email-link and reset pages have no mount harness; pin their source.
  it.each([
    'app/components/auth/AuthLoginCard.vue',
    'app/components/auth/AuthRegisterCard.vue',
    'app/components/auth/AuthExchangePanel.vue',
    'app/pages/auth/email-link.vue',
    'app/pages/reset-password.vue',
  ])('%s finishes sign-in with a full page load, never a client-side navigateTo', (path) => {
    const source = read(path)
    expect(source).toContain('signInLandingPath(')
    expect(source).toContain('FULL_PAGE_LOAD')
    // The pre-change shape: a server redirectTo handed straight to a client-side navigateTo.
    expect(source).not.toMatch(/redirectTo \?\? /u)
  })
})
