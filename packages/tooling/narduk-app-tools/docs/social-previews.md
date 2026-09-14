# Social previews: defaults, route images, and delivery checks

Every app with a shareable HTTP URL needs an image for that URL, including
native apps' public landing and universal-link pages. The app owns the artwork,
public content, route inventory, and deployment. These commands run on one
checkout; they never synchronize or change other apps.

## Default image

Commit an app-branded, single-frame 1200×630 PNG, JPEG, or WebP below 5 MB under
`public/`. PNG is the scaffold default. The dimensions and byte ceiling are the
Narduk compatibility contract, not a claim that every social platform has
identical limits. Keep the image legible when reduced to a message bubble: app
identity, a short useful description, and generous margins.

The generator writes `public/og-source.svg`, an app-branded source rather than a
generic library logo. It does not need an image-generation service. After the
first install, render and commit the image:

```sh
pnpm exec narduk-app og:generate
pnpm exec narduk-app og:check
```

`og:generate` refuses to overwrite artwork. `--force` deliberately replaces it;
`--if-missing` generates only an absent image and validates any existing image.
Builds use `--if-missing`, followed by the offline check. They do not keep
rewriting an app's finished artwork. A missing or corrupt source/image is a
build failure.

For Nuxt with `narduk-seo`, configure the fallback once:

```ts
export default defineNuxtConfig({
  modules: [
    '@narduk-enterprises/narduk-core',
    '@narduk-enterprises/narduk-seo',
  ],
  site: {
    url: 'https://example.com',
    name: 'Example',
    description: 'Public app description.',
  },
  nardukSeo: {
    defaultOgImage: {
      url: '/og.png',
      alt: 'Example — public app description.',
    },
  },
})
```

The fallback is emitted on every page, at low head priority, including pages
that never call `useSeo` and pages marked `noindex`. Page metadata and generated
images override it. Adding the SEO module alone does **not** create a static
image or configure this fallback; existing consumers must supply the real asset
and option. The option is additive and unset for older consumers.

The generator also wires server-visible defaults for core-only apps. In other
frameworks, emit equivalent OG title, description, type, URL, image, alt text,
width/height, `twitter:card=summary_large_image`, and `twitter:image` in the
initial HTML head. Use absolute HTTPS URLs. JavaScript hydration is not a
delivery mechanism for social crawlers. SPAs need metadata in their HTML shell
or a public SSR/static landing page. A native app's custom URL scheme is not an
HTTP preview page.

## Route-specific images

Use a content-specific image whenever the linked thing differs: an article,
product, public profile, place, event, report, or public shared result. Generic
marketing/navigation pages may keep the default. A parameterized URL is a prompt
to classify the page, not permission to expose its data.

With `narduk-seo`, await the public page data before declaring the image:

```vue
<script setup lang="ts">
const route = useRoute()
const { data: article } = await useFetch(
  `/api/public/articles/${route.params.slug}`,
)
if (!article.value)
  throw createError({ statusCode: 404, statusMessage: 'Not found' })

useSeo({
  title: article.value.title,
  description: article.value.summary,
  type: 'article',
  ogImage: {
    title: article.value.title,
    description: article.value.summary,
    alt: article.value.title,
  },
})
</script>
```

`useSeo` supplies `og:url` and a canonical link from the configured site origin
and page path unless `canonicalUrl` is explicitly set. Generated templates
already exist in `narduk-seo`; use `ogImage.component` for an app-specific
supported template. For a generic page, `ogImage: false` leaves the configured
static fallback.

Automatic generation still skips explicit `robots: 'noindex'` callers. A public,
unlisted page may explicitly pass an `ogImage` object to request a preview while
remaining noindex. Search indexability is distinct from data privacy. Private,
personalized, administrative, and preview content stays out of image props; an
image URL is public and cacheable even if the declaring page requires login.

For Cloudflare runtime generation, declare the `OG_IMAGE_CACHE` KV binding and
provision `NUXT_OG_IMAGE_SECRET` separately in every environment. The secret
never belongs in this JSON file or public runtime config. Keep real missing
records at 404; do not turn them into plausible fixture images. Cache public
images, and use revisioned image URLs when the underlying published content
changes. A fallback meta tag cannot repair a selected dynamic endpoint
returning 500.

## App-owned route inventory

Store `Config/social-previews.json` relative to the web app root:

```json
{
  "schemaVersion": 1,
  "siteUrl": "https://example.com",
  "defaultImage": {
    "path": "/og.png",
    "alt": "Example app",
    "source": "public/og-source.svg"
  },
  "pagesDir": "app/pages",
  "routes": [
    { "source": "index.vue", "kind": "default", "paths": ["/"] },
    {
      "source": "articles/[slug].vue",
      "kind": "dynamic",
      "paths": [
        "/articles/first-public-example",
        "/articles/second-public-example"
      ]
    },
    {
      "source": "account.vue",
      "kind": "private",
      "reason": "Authenticated account data"
    }
  ]
}
```

`source` is relative to `pagesDir`. Every `.vue` file needs exactly one row; new
unclassified pages, stale sources, duplicate samples, missing images, and
invalid configuration fail. Private rows need a reason and are never fetched.
Parameterized dynamic routes need at least two distinct real examples. A
parameterized generic shell needs a reason for `kind: "default"`. Single fixed
routes can use one dynamic example; the image still must differ from the
default.

Declare module-added and server-defined routes with `source: null` and a reason
identifying the owner. Aliases and localized paths belong in their page's
samples. The generator includes the SEO layer's public directory and private
preview tool. For non-Nuxt routers, set `pagesDir: null` and add `inventoryNote`
identifying the app's route-enumeration/review mechanism. This disables Vue file
discovery; it does **not** prove an external router is completely covered.
Maintain that inventory from the app's router or route manifest, and review it
whenever routes change.

## Local, CI, and deployed proof

```sh
# Offline: inventory + full image decode; no network and no production claim.
pnpm exec narduk-app og:check

# Initial HTML and actual image bytes on a running local server.
pnpm exec narduk-app og:check --live --base-url http://127.0.0.1:3000

# After deployment: the canonical HTTPS origin, without an override.
pnpm exec narduk-app og:check --live --json
```

`--root` selects an app directory; `--config` selects an app-relative JSON file.
From a generated monorepo root the CLI detects `apps/web`. From another layout,
pass `--root` explicitly. Keep the canonical origin in this JSON and Nuxt config
consistent. HTTP is permitted only for explicit loopback development probes.

The live check requests HTML without cookies or authorization under Twitterbot
and Applebot user agents. It checks the initial head, exactly one of each
required image tag, canonical page URL, declared dimensions, selected image
response status, Content-Type, complete image decode, and actual pixels. It also
checks the deployed default against the local artwork. Dynamic examples must
differ from the default and from one another within their route family; changing
just a URL is insufficient. An `og:image` present only inside a comment, script,
template, or body does not count.

Images from a CDN need explicit HTTPS origins in `imageOrigins`. Page redirects
stay on the selected origin, and image redirects stay on declared origins.
Requests are bounded to four concurrent checks, three redirects, ten seconds per
request, 1 MB per HTML page, 5 MB per image, and two minutes for the whole
network run. Shared image downloads are reused within one run and crawler
profile. The process exits nonzero on failure. JSON output contains the mode,
target/canonical origins, coverage counts, and errors; an offline pass is never
a live pass.

The generator runs offline checks from both build commands and adds a Playwright
test that invokes the same live checker against its test server. Existing apps
adopt these scripts/tests deliberately, then run the canonical-origin check
after deployment. Older pinned packages and existing apps are not retroactively
upgraded.

Finally, inspect the default and representative dynamic images at full size and
message-bubble size. Test a safe URL in iMessage and the X composer. Applebot is
a crawler probe, not the iMessage client, and a successful request cannot force
X or iMessage to refresh cached previews or guarantee their current visual
presentation. Do not publish a message merely to run this check. Preserve
Access/auth boundaries; an inaccessible app needs a separate safe public share
landing page.

Protocol references: [Open Graph metadata](https://ogp.me/),
[Apple rich previews](https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages),
and [Nuxt OG Image](https://nuxtseo.com/og-image).
