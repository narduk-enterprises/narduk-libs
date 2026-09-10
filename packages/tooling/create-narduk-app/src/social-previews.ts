import type { GeneratedFile } from './types.js'

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function lines(value: string, width: number, count: number): string[] {
  const words = value
    .trim()
    .split(/\s+/u)
    .flatMap((word) => word.match(new RegExp(`.{1,${width}}`, 'gu')) ?? [])
  const result: string[] = []
  let line = ''
  for (const word of words) {
    if (line && line.length + word.length + 1 > width) {
      result.push(line)
      line = ''
    }
    line += (line ? ' ' : '') + word
  }
  if (line) result.push(line)
  if (result.length > count) result[count - 1] = (result[count - 1] ?? '').slice(0, width - 1) + '…'
  return result.slice(0, count)
}

export function socialPreviewFiles(
  displayName: string,
  description: string,
  siteUrl: string,
  seo: boolean,
): GeneratedFile[] {
  const title = lines(displayName, 27, 2)
    .map((line, index) => `<tspan x="88" dy="${index ? 78 : 0}">${xml(line)}</tspan>`)
    .join('')
  const summary = lines(description, 60, 3)
    .map((line, index) => `<tspan x="88" dy="${index ? 36 : 0}">${xml(line)}</tspan>`)
    .join('')
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
              source: 'public/og-source.svg',
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
      path: 'apps/web/public/og-source.svg',
      contents: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#101b30"/><stop offset="1" stop-color="#192f4b"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <path d="M920 0H1200V630H1080Z" fill="#223d57"/>
  <rect x="88" y="96" width="72" height="8" rx="4" fill="#f4b26b"/>
  <text y="242" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="66" font-weight="700">${title}</text>
  <text y="404" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="28">${summary}</text>
  <text x="88" y="558" fill="#f4b26b" font-family="Arial, Helvetica, sans-serif" font-size="24">${xml(new URL(siteUrl).host)}</text>
</svg>
`,
    },
    {
      path: 'apps/web/tests/e2e/social-previews.spec.ts',
      contents: `import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { checkSocialPreviews, readSocialPreviewConfig } from '@narduk-enterprises/narduk-app-tools'

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

The app owns apps/web/Config/social-previews.json and public/og-source.svg. After
the first install, run pnpm run og:generate and commit the resulting public/og.png.
Edit the source to match the product; run pnpm run og:generate --force to replace
the PNG deliberately. Builds generate it only when missing and validate existing images.

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
