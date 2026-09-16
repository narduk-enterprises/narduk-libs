import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildSeoOgImagePreviewPath } from '../server/utils/ogImagePath'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

interface OgImageUrlEncoding {
  buildOgImageUrl: (
    options: Record<string, unknown>,
    extension?: string,
    isStatic?: boolean,
    defaults?: Record<string, unknown>,
    secret?: string,
  ) => { url: string }
  verifyOgImageSignature: (encoded: string, signature: string, secret: string) => boolean
}

// nuxt-og-image does not export its URL helpers, so load the pinned release's
// own encoder from disk. A dependency bump that changes the URL format fails here.
async function loadOgImageUrlEncoding(): Promise<OgImageUrlEncoding> {
  const ogImageRoot = realpathSync(join(packageRoot, 'node_modules', 'nuxt-og-image'))
  const modulePath = join(ogImageRoot, 'dist', 'runtime', 'shared', 'urlEncoding.js')
  return (await import(pathToFileURL(modulePath).href)) as OgImageUrlEncoding
}

const defaults = { width: 1200, height: 630, extension: 'png', component: 'Default' }

const cases = [
  {
    component: 'Default',
    props: { title: 'Buoy 41002', description: 'South Hatteras' },
    key: 'og',
    _path: '/__preview/og-images',
  },
  {
    component: 'Article',
    props: { title: 'Wave height 101', category: 'Guides' },
    width: 1600,
    _path: '/__preview/og-images',
  },
  { component: 'Default', props: { title: 'Ünïcode — title' }, _path: '/__preview/og-images' },
  {
    component: 'Default',
    props: { title: 'with_underscore and space', primaryColor: '#0ea5e9' },
    _path: '/__preview/og-images',
  },
  { component: 'Default', props: { title: 'Top 5*' }, _path: '/__preview/og-images' },
  {
    component: 'Default',
    props: { title: '~tilde start' },
    alt: 'Alt text',
    cacheMaxAgeSeconds: 3600,
    _path: '/__preview/og-images',
  },
]

describe('buildSeoOgImagePreviewPath', () => {
  it.each(cases)('matches nuxt-og-image URLs for $props.title', async (options) => {
    const { buildOgImageUrl, verifyOgImageSignature } = await loadOgImageUrlEncoding()
    const ordered = {
      props: options.props,
      width: options.width,
      height: undefined,
      component: options.component,
      alt: options.alt,
      cacheMaxAgeSeconds: options.cacheMaxAgeSeconds,
      key: options.key,
      _path: options._path,
    }

    for (const secret of [undefined, 'test-signing-secret']) {
      const path = buildSeoOgImagePreviewPath(options, { baseURL: '/', defaults, secret })

      expect(path).toBe(buildOgImageUrl(ordered, 'png', false, defaults, secret).url)

      if (secret) {
        const signed = /^\/_og\/d\/(.+),s_([^,]+)\.png$/.exec(path)

        expect(signed).not.toBeNull()
        expect(verifyOgImageSignature(signed![1], signed![2], secret)).toBe(true)
      }
    }
  })
})
