import type { GeneratedFile } from './types.js'

export function socialPreviewFiles(
  displayName: string,
  description: string,
  siteUrl: string,
  seo: boolean,
): GeneratedFile[] {
  return [
    {
      path: 'apps/web/Config/social-previews.json',
      contents:
        JSON.stringify(
          {
            schemaVersion: 1,
            siteUrl,
            defaultImage: {
              path: '/og.png',
              alt: `${displayName} — ${description}`.slice(0, 420),
            },
            pagesDir: 'app/pages',
            routes: [
              { source: 'index.vue', kind: 'default', paths: ['/'] },
              ...(seo
                ? [
                    {
                      source: null,
                      kind: 'dynamic',
                      paths: ['/narduk-network'],
                      reason: 'Public directory registered by narduk-seo',
                    },
                    {
                      source: null,
                      kind: 'private',
                      reason: 'narduk-seo /__preview/og-images is an internal preview tool',
                    },
                  ]
                : []),
            ],
          },
          null,
          2,
        ).replaceAll(/("paths": )\[\n\s+("[^\n]+")\n\s+\]/gu, '$1[$2]') + '\n',
    },
    ...(!seo
      ? [
          {
            path: 'apps/web/app/plugins/social-url.ts',
            contents: `export default defineNuxtPlugin(() => {
  const route = useRoute()
  const config = useRuntimeConfig()
  useSeoMeta({ ogUrl: () => new URL(route.path, String(config.public.appUrl)).href })
})
`,
          },
        ]
      : []),
    {
      path: 'apps/web/tests/e2e/social-previews.spec.ts',
      contents: `import { fileURLToPath } from 'node:url'

import { checkSocialPreviews, readSocialPreviewConfig } from '@narduk-enterprises/narduk-app-tools'
import { expect, test } from '@playwright/test'

test('share previews are present in HTML and resolve to real images', async ({ baseURL }) => {
  test.setTimeout(180_000)
  if (!baseURL) throw new Error('Playwright baseURL is required')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const config = readSocialPreviewConfig(root, 'Config/social-previews.json')
  const report = await checkSocialPreviews(config, root, { live: true, baseUrl: baseURL })
  expect(report.errors).toEqual([])
  expect(report.ok).toBe(true)
})
`,
    },
    {
      path: 'docs/social-previews.md',
      contents: `# Social previews

Every shareable URL has a default image. Articles, products, places, public profiles,
and other individually shared content need route-specific images built from public data.

The app owns apps/web/Config/social-previews.json and apps/web/Config/brand.json.
The brand file (name, tagline, four colours, card layout and texture) is the one
input for the favicon set, site.webmanifest and the default share card. The
generator starts it from a palette picked for this app; replace the colours with
the product's own art direction, or point icon at a kept app-icon render from
the asset-pack skill. After editing it, run pnpm run assets:generate --force and
commit apps/web/public. Builds generate missing files and then run
narduk-app assets check, which fails on a missing, placeholder or generic icon,
manifest or share card. To ship a hand-made card instead, set defaultImage.source
to an SVG or PNG in this inventory; og:generate rasterises it.

Add every new app/pages file to the inventory. Use kind=default for generic app
pages; use kind=dynamic with at least two different real paths for content pages;
use kind=private with a reason for authenticated, administrative, or preview pages.
Parameterized routes using the default also require a reason. Seed the declared
public examples for CI. Adding a page without classifying it fails the build.

For dynamic pages, enable the seo capability and call useSeo after awaiting public
page data, with a canonical URL and ogImage props derived from that data. Configure
OG_IMAGE_CACHE and NUXT_OG_IMAGE_SECRET for each deployed environment; never put
personal data or credentials into the image props. Public unlisted pages can
explicitly request ogImage even with noindex. Keep private pages on the safe default.

Commands:

- pnpm run assets:check — favicon set, manifest and share card are real (not placeholders).
- pnpm run assets:check:live — the same, plus head links and theme-color, against the deployed site.
- pnpm run og:check — local route coverage and decoded default image.
- pnpm run test:e2e — includes crawler metadata and image checks against the test server.
- pnpm run og:check:live — the same checks against the configured HTTPS siteUrl after deployment.

The live check fetches the server-rendered head and selected image without login
using Twitterbot and Applebot user agents. It verifies 1200x630 pixels, a matching
image Content-Type, metadata, and distinct image pixels for dynamic examples.
It does not impersonate the actual iMessage client or guarantee a platform's cache
has refreshed. Visually inspect the default and representative dynamic images;
paste a public URL into iMessage and the X composer before calling sharing verified.
Do not send or publish a message as part of that check without authorization.

Set the real canonical siteUrl in both Nuxt configuration and this inventory before
release. The live release check rejects HTTP; --base-url permits an explicit HTTP
loopback server for development. Authentication/Access walls stay intact: use a
separate safe public landing URL when the application itself is not crawler-accessible.

For full metadata examples, route-specific generation, custom routers, and migration,
read the [shared guide](https://github.com/narduk-enterprises/narduk-libs/blob/main/packages/tooling/narduk-app-tools/docs/social-previews.md).
`,
    },
  ]
}
