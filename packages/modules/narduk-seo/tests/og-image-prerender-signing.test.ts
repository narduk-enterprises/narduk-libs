import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface OgImageUrlEncoding {
  buildOgImageUrl: (
    options: Record<string, unknown>,
    extension?: string,
    isStatic?: boolean,
    defaults?: Record<string, unknown>,
    secret?: string,
  ) => { hash?: string; url: string }
  verifyOgImageSignature: (encoded: string, signature: string, secret: string) => boolean
}

// Same loader as `og-image-path.test.ts`: nuxt-og-image does not export its URL
// helpers, so the pinned release's own encoder is read off disk. A dependency
// bump that changes this behaviour fails here rather than in production.
async function loadOgImageUrlEncoding(): Promise<OgImageUrlEncoding> {
  const ogImageRoot = realpathSync(join(packageRoot, 'node_modules', 'nuxt-og-image'))
  const modulePath = join(ogImageRoot, 'dist', 'runtime', 'shared', 'urlEncoding.js')
  return (await import(pathToFileURL(modulePath).href)) as OgImageUrlEncoding
}

/**
 * Mirror of `nuxt-og-image/dist/runtime/app/utils.js:101`, the line that decides
 * whether a page emits a static or a runtime OG image URL:
 *
 * ```js
 * const isStatic = import.meta.prerender && !(security?.secret && security?.strict)
 * ```
 *
 * It is restated here because the real one runs inside a Nuxt app render. The
 * URL assertions below all come from nuxt-og-image's own `buildOgImageUrl`.
 */
function resolveIsStatic(input: {
  prerender: boolean
  secret?: string
  strict?: boolean
}): boolean {
  return input.prerender && !(input.secret && input.strict)
}

const defaults = { width: 1200, height: 630, extension: 'png', component: 'Default' }
const secret = 'test-signing-secret'
const options = {
  props: { title: 'Wave height 101', description: 'South Hatteras' },
  component: 'Default',
  key: 'og',
  _path: '/stations/41002',
}

// These pin the upstream behaviour the fix for #170 depends on: because a
// prerendered page emits an *unsigned* `/_og/s/...` URL, the only way that URL
// can ever resolve is for the prerender crawler to bake the image to a file --
// which is why `src/module.ts` no longer pins `/_og/**` to `prerender: false`.
// A dependency bump that changed any of this would silently reintroduce the
// 403 the issue reported, so it fails here instead.
describe('narduk-libs#170: prerendered pages and /_og/** URL signing', () => {
  it('emits an unsigned static URL when a prerendered page has a secret but no strict mode', async () => {
    const { buildOgImageUrl } = await loadOgImageUrlEncoding()
    const isStatic = resolveIsStatic({ prerender: true, secret, strict: false })

    expect(isStatic).toBe(true)

    const { url } = buildOgImageUrl(options, 'png', isStatic, defaults, secret)

    // The static prefix, and no `,s_<signature>` segment: signing is skipped
    // for a static URL even though a secret is configured.
    expect(url.startsWith('/_og/s/')).toBe(true)
    expect(url).not.toMatch(/,s_[^,]+\.png$/)
  })

  it('emits a verifiable signed runtime URL for the same page under strict mode', async () => {
    const { buildOgImageUrl, verifyOgImageSignature } = await loadOgImageUrlEncoding()
    const isStatic = resolveIsStatic({ prerender: true, secret, strict: true })

    expect(isStatic).toBe(false)

    const { url } = buildOgImageUrl(options, 'png', isStatic, defaults, secret)
    const signed = /^\/_og\/d\/(.+),s_([^,]+)\.png$/.exec(url)

    expect(signed).not.toBeNull()
    expect(verifyOgImageSignature(signed![1], signed![2], secret)).toBe(true)
  })

  it('collapses a long static payload to the hashed o_<hash> form the issue reported', async () => {
    const { buildOgImageUrl } = await loadOgImageUrlEncoding()
    const longOptions = {
      ...options,
      props: {
        title: 'A title long enough to push the encoded payload past the static path limit'.repeat(
          4,
        ),
        description: 'and a description that keeps it there'.repeat(4),
      },
    }

    const { url } = buildOgImageUrl(longOptions, 'png', true, defaults, secret)

    // `https://gd.loganrenz.com/_og/s/o_esbm28.png` in narduk-libs#170 is this
    // shape: a static path with the options replaced by a content hash.
    expect(url).toMatch(/^\/_og\/s\/o_[^.]+\.png$/)
  })
})
