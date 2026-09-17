import { describe, expect, it } from 'vitest'

import { buildGeneratedFiles } from '../src/index.js'

function generate(capabilities: Array<'analytics' | 'auth' | 'seo' | 'uploads'> = []) {
  return new Map(
    buildGeneratedFiles({
      appName: 'error-page-app',
      capabilities,
      visibility: 'private',
      targetDir: '/tmp/error-page-app',
    }).map((file) => [file.path, file.contents]),
  )
}

describe('generated apps inherit the shared error page', () => {
  it('scaffolds no app-owned error.vue, so narduk-core’s page is what renders', () => {
    // narduk-core sets Nuxt's `app.errorComponent` from `app:resolve` only when
    // the app has not supplied one. An `apps/web/app/error.vue` here — even a
    // placeholder — would silently take the estate page out of every new app.
    for (const capabilities of [[], ['analytics'], ['auth', 'seo', 'uploads']] as const) {
      const files = generate([...capabilities])
      expect([...files.keys()].filter((path) => path.includes('error.vue'))).toEqual([])
    }
  })

  it('registers no app-owned error listener or error Nitro plugin', () => {
    const files = generate(['analytics'])
    const sources = [...files].filter(([path]) => path.endsWith('.ts') || path.endsWith('.vue'))

    for (const [path, contents] of sources) {
      expect(contents, path).not.toContain("hook('vue:error'")
      expect(contents, path).not.toContain("hook('app:error'")
      expect(contents, path).not.toContain("hooks.hook('error'")
    }
  })

  it('documents where the page and the capture come from', () => {
    const files = generate()
    const doc = files.get('docs/error-page.md') ?? ''

    expect(files.get('README.md')).toContain('## Error page and exception capture')
    expect(files.get('README.md')).toContain('[docs/error-page.md](docs/error-page.md)')
    expect(doc).toContain('app.errorComponent')
    expect(doc).toContain('narduk:exception')
    expect(doc).toContain('error-page-request-id')
    // The override path has to be written down, or an app that needs its own
    // page forks the estate one instead of wrapping it.
    expect(doc).toContain('@narduk-enterprises/narduk-core/app/error-page')
  })
})
