# @narduk-enterprises/narduk-seo

Optional public SEO, Schema.org, and Open Graph capabilities for SSR apps.

Use this package when an app is meant to be publicly discoverable and should
ship structured data, canonical metadata, and OG image helpers. Internal
operator consoles and other `ssr: false` apps should stay on
`@narduk-enterprises/narduk-core` and use `useSeoMeta()` / `useHead()` directly
instead.

This layer also owns the optional OG preview/admin utilities so public-web SEO
tooling stays out of `core` and auth-only app shells.

Dynamic OG images are enabled by default for crawlable pages that call
`useSeo(...)`. Explicit `noindex` callers skip automatic generation; public
unlisted pages can still request it with an explicit `ogImage` object. A page
can opt out with `ogImage: false`. Private data never belongs in image props.

Non-dev builds that leave runtime OG generation enabled require a non-empty
`NUXT_OG_IMAGE_SECRET`. An empty string is not a secret: `nuxt-og-image` then
auto-generates a fresh one per build, so every previously signed `/_og/` URL
stops verifying -- a rolling Worker release serves two secrets at once and
cached signed URLs 403 until regenerated. Signing is resolved at **build** time,
so provision it as a Workers Builds **Build variable**, not as a runtime Worker
secret. `nuxt dev` stays permissive. `nuxt-og-image` is an **optional peer**
(narduk-libs#170) at `6.8.0`: omit the peer only for a static `defaultOgImage`
by setting `ogImage.enabled: false`. Add `nuxt-og-image@6.8.0` when you need
runtime OG or build-time prerender cards (`ogImage.zeroRuntime: true` still
installs the module; it only disables the request-time renderer). If the package
is not installed, this layer skips the renderer instead of failing the build,
and `useSeo` falls back to the static image. That skip is silent on the
default/static path; a warning fires only when the app set
`ogImage.enabled: true` and the peer is missing. The committed CI placeholder is
rejected on builds the estate deploys -- Workers Builds (`WORKERS_CI`) and a
local `wrangler deploy` behind `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY`. Builds
nothing deploys (`nuxt dev`, GitHub Actions `build:ci`, packed-consumer
fixtures) may still use it. Never set `ogImage.security.secret: false` -- that
is the setting that actually disables signing and leaves `/_og/` an
unauthenticated renderer.

**A prerendered page bakes its OG card at build time** (narduk-libs#170).
`nuxt-og-image` picks how to address an image while the page renders: during a
prerender it emits an _unsigned_ `/_og/s/...` URL and relies on the prerender
crawler to write that image out as a file. This layer therefore leaves `/_og/**`
prerenderable. It used to pin `{ prerender: false }`, which stopped the file
being produced and left the unsigned URL to be served at runtime, where the
handler rejects it as soon as a signing secret is configured:

```
GET /_og/s/o_esbm28.png
-> 403 [Nuxt OG Image] Missing URL signature.
```

SSR pages are unaffected either way -- they take the signed `/_og/d/...` branch,
which verifies at request time.

Three consequences of baking, worth knowing before you prerender a large route
set. **Output**: one image file per prerendered page that renders a card, added
to the app's static assets, where it counts against the Workers per-file size
and total file-count ceilings like any other asset. **Build time**: it grows
with the number of prerendered pages that render a card, because each one is
rendered during the build rather than on first request -- the honest trade for
not rendering them at runtime. **Freshness**: unchanged. A baked card is exactly
as stale as the page it was built from, so a route whose card must track data
that moves between deploys should not be prerendered in the first place.

Every app also needs a real static default image. Set
`nardukSeo.defaultOgImage: { url: '/og.png', alt: 'Your app description' }` to
emit it site-wide, including pages that never call `useSeo`. Page-specific
images override this fallback. The package does not fabricate or ship an app's
artwork. Use `narduk-app og:generate` and the offline/live `og:check` commands
from `narduk-app-tools`; the
[shared guide](../../tooling/narduk-app-tools/docs/social-previews.md) covers
route inventory, rendering, crawler delivery, and existing-app adoption.

Typical app setup:

```ts
export default defineNuxtConfig({
  extends: [
    '@narduk-enterprises/narduk-core',
    '@narduk-enterprises/narduk-seo',
  ],
  site: {
    url: 'https://example.com',
    name: 'Example App',
    description: 'Public app description.',
    defaultLocale: 'en',
  },
  nardukSeo: {
    defaultOgImage: {
      url: '/og.png',
      alt: 'Example App — public app description.',
    },
  },
  schemaOrg: {
    identity: {
      type: 'Organization',
      name: 'Example App',
      url: 'https://example.com',
      logo: '/favicon.svg',
    },
  },
})
```

When this layer is present, public crawlable pages should call `useSeo(...)` and
the appropriate `use*Schema(...)` helper in `script setup`.

For local visual QA, the layer ships a preview lab at `/__preview/og-images`. It
is enabled automatically in development and can be exposed in preview
environments with `NUXT_PUBLIC_OG_IMAGE_PREVIEW=true`. The shared sitemap and
robots defaults exclude non-public route families such as `/__preview/**`,
`/admin/**`, `/api/**`, auth pages, dashboard pages, settings pages, and account
pages so downstream apps do not accidentally publish operator or preview URLs as
crawl targets.

Staging and preview deployments are not indexable by default. When
`NARDUK_DEPLOY_TARGET` is `staging` or `preview`, the layer sets site
`indexable: false`, emits `noindex, nofollow` robots metadata, blocks all
robots.txt crawling, and disables sitemap generation. A deployment that
intentionally needs indexing in a non-production environment must opt in with
`nardukSeo: { indexNonProduction: true }` or
`NARDUK_SEO_INDEX_NON_PRODUCTION=true`.

## Canonical URLs: pass a path, never an absolute

`useSeo` resolves the canonical and `og:url` itself, from `canonicalUrl` when
you give one and from `route.path` when you do not. **Give it a relative path.**

```ts
useSeo({ title, description }) // canonical = this route
useSeo({ title, description, canonicalUrl: `/lakes/${state}/${lake}` })
```

Do not build an absolute URL in the app. An absolute is accepted only when its
origin equals the site origin, and an app that composes one from
`runtimeConfig.public.siteUrl` gets `http://localhost:3000/...` in any
deployment where `SITE_URL` is unset — a cross-origin value, refused. The page
then falls back to its own route, which is almost certainly what you meant, and
development logs a warning naming both sides. Earlier releases fell back to the
site root instead, which meant one unset variable made every page on a site
declare the root as its own canonical: valid, plausible, and wrong everywhere at
once (narduk-libs#590).

Protocol-relative values, backslash smuggling, and userinfo are refused the same
way, and the site root is still the last resort when neither the given value nor
the route is usable.

## security.txt (RFC 9116)

`/.well-known/security.txt` is off until the app sets a contact. The package
does not invent a reporting address. When `contact` is present, the module bakes
an RFC 9116 body at build time and serves it from `/.well-known/security.txt`
and `/security.txt` with `Content-Type: text/plain; charset=utf-8`. `Expires` is
build time plus `expiresDays` (default 365, maximum 365). Enabling the option
without a contact is a build-time error.

```ts
export default defineNuxtConfig({
  nardukSeo: {
    securityTxt: {
      contact: 'mailto:security@example.com',
      // expiresDays: 365,
      // policy: 'https://example.com/security',
      // acknowledgments: 'https://example.com/hall-of-fame',
      // preferredLanguages: ['en'],
      // canonical: 'https://example.com/.well-known/security.txt',
    },
  },
})
```

`contact` accepts a mailto:, https:, or tel: URI, a bare email (prefixed with
`mailto:`), or an array of those. `policy`, `acknowledgments`, and `canonical`
must be `https://` URIs. No field may contain a line break (`\r` or `\n`) —
security.txt is one field per line, so an embedded line break could inject an
extra field; the module throws a build-time error instead.

**`Expires` is baked in at build time and never refreshes on its own.** An app
that goes a year or more without a redeploy will start serving a stale (or
outright expired) security.txt with no other signal. This package does not add a
health-check integration for it — the served route logs one `console.warn` per
isolate when `Expires` is at or within 30 days of passing, which is enough to
show up in existing log/error tooling. Redeploying refreshes `Expires`, so apps
that expect to go a long time between deploys should either redeploy
periodically or set a shorter `expiresDays`.

## AI-crawler policy

`nardukSeo.aiCrawlers` adds extra `@nuxtjs/robots` groups. It does not install a
second robots.txt generator. The default is `'allow'`, which emits no extra
groups, so apps that set nothing keep today's robots.txt.

```ts
export default defineNuxtConfig({
  nardukSeo: {
    // Block every known AI crawler:
    aiCrawlers: 'disallow',
    // Or name them (must be members of AI_CRAWLERS):
    // aiCrawlers: { allow: ['GPTBot'], disallow: ['CCBot'] },
  },
})
```

The maintained list is exported as `AI_CRAWLERS` from the package root and from
`@narduk-enterprises/narduk-seo/shared/aiCrawlers`: GPTBot, ChatGPT-User,
OAI-SearchBot, ClaudeBot, Claude-Web, anthropic-ai, Google-Extended,
PerplexityBot, CCBot, Bytespider, Amazonbot, Applebot-Extended,
meta-externalagent, cohere-ai.

## Narduk network directory

**The directory endpoint is injectable and has no default. It is off unless you
configure it.**

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  nardukSeo: {
    networkDirectoryUrl: 'https://your-catalog.example.com/api/network.json',
  },
})
```

or, at runtime (build-once friendly):

```
NUXT_PUBLIC_NARDUK_NETWORK_DIRECTORY_URL=https://your-catalog.example.com/api/network.json
```

When it is unset, the feature disables itself by design:
`/api/narduk-network/sites` makes **no outbound request**,
`useNardukNetworkDirectory()` skips its fetch, `/narduk-network` renders an
empty directory, and `LayerNetworkFooter` omits the `/narduk-network` link. This
is intentional — the directory is a marketing cross-link surface, not a gate, so
failing quiet is correct. A published package must never make every downstream
app poll a hostname it did not choose.

The value must be an absolute **HTTPS** URL; anything else resolves to "not
configured".

Separately, `runtimeConfig.public.publicCatalogBaseUrl` (env
`PUBLIC_CATALOG_BASE_URL`) supplies the catalog-hub link that
`LayerNetworkFooter` renders and the `isPartOf` JSON-LD wiring. It is a link
target only — it never triggers a fetch — and the footer omits the hub link when
it is unset. The SEO layer owns the crawlable `/narduk-network` page and adds it
to the sitemap; it does not render an all-to-all list of sites in every footer.

The catalog application owns curation, publication, and the public/indexable
classification. The feed shape is:

```json
{
  "updatedAt": "2026-04-25T12:00:00.000Z",
  "sites": [
    {
      "slug": "example-app",
      "name": "Example App",
      "url": "https://example.nard.uk",
      "description": "Short public description."
    }
  ]
}
```

The layer validates the feed, keeps only HTTPS URLs, removes duplicates,
excludes the current app origin, and skips entries explicitly marked
`"public": false` or `"indexable": false`. If the feed cannot be loaded,
`/narduk-network` renders the empty state instead of throwing.

The catalog publishes only public, canonical, indexable apps. Do not hardcode
app lists inside this package.

Schema helpers such as `useWebSiteSchema` and `useSoftwareApplicationSchema`
accept explicit `url` / `isPartOfUrl` / `catalogUrl` arguments — pass the
catalog origin from `useRuntimeConfig().public.publicCatalogBaseUrl` (or a
literal) when building fleet-app JSON-LD so `isPartOf` points at the hub.

## Structured-data composables

Available as auto-imported helpers in app `<script setup>`:

- `useSeo(...)` — title, description, OG image, robots.
- `useWebPageSchema(...)` — WebPage JSON-LD.
- `useArticleSchema(...)` — Article JSON-LD for blog posts.
- `useBreadcrumbSchema(...)` — BreadcrumbList JSON-LD.
- `useFAQSchema(...)` — FAQPage JSON-LD.
- `useLocalBusinessSchema(...)` — LocalBusiness JSON-LD.
- `useProductSchema(...)` — Product JSON-LD.
- `useItemListSchema(items, options?)` — ItemList JSON-LD for catalog pages.
- `useDatasetSchema(input)` — Dataset JSON-LD for pages that publish a data
  series: `variableMeasured`, `temporalCoverage`, `distribution`, `license` and
  `creator`. Feeds Google Dataset Search and AI-discovery surfaces.
- `useSoftwareApplicationSchema(input)` — SoftwareApplication JSON-LD with
  optional `isPartOf` linkback to the catalog hub.
- `useWebSiteSchema(input?)` — WebSite JSON-LD with optional `SearchAction`
  potentialAction and `isPartOf` linkback.
- `useSiteWebSiteSchema(overrides?)` — `WebSite` from site + runtime config,
  with optional `SearchAction` from `public.seoSearchActionUrlTemplate` (env) or
  overrides (recommended for home / one layout).
- `useOrganizationSchema(input?)` — Organization JSON-LD.
- `useNardukNetworkDirectory()` — Fetches the package-normalized catalog network
  directory response for `/narduk-network`.

### `WebSite` + `SearchAction` (Sitelinks search / Rich Results)

Pass `searchActionUrlTemplate` with the **public search URL** your app really
uses, with the literal `{search_term_string}` placeholder. Example for a `?q=`
style search under `/search/`:

```ts
const config = useRuntimeConfig()
const site = String(config.public.appUrl || '').replace(/\/$/, '')
if (site) {
  useWebSiteSchema({
    name: 'My App',
    url: site,
    description: '…',
    searchActionUrlTemplate: `${site}/search/?q={search_term_string}`,
  })
}
```

`useWebSiteSchema` without `searchActionUrlTemplate` is still valid — you get a
`WebSite` node in the graph for entity clarity.

Google’s **Rich Results Test** only flags _eligible_ rich result types; a valid
`SearchAction` may still return “no items” depending on query and eligibility,
but the markup is what Search Console and Googlebot consume. Validate JSON-LD in
page source (or the tool’s “view tested page”) to confirm the script is present
after SSR.

### Fleet defaults: `useSiteWebSiteSchema`, env-driven `SearchAction`, and X (Twitter) site

- **`useSiteWebSiteSchema(overrides?)` —** Calls `useWebSiteSchema` with `name`
  / `description` / `url` from `useSiteConfig()` and `runtimeConfig.public`
  (`appUrl` fallback), so the home page can be a one-liner. Optional
  `SearchAction` is taken from `NUXT_PUBLIC_SEO_SEARCH_ACTION_URL_TEMPLATE` when
  set in Doppler (e.g. `https://example.com/search/?q={search_term_string}`), or
  from overrides when you need a path the env cannot express.
- **`resolveSiteOriginForSchemaInput` —** Shared helper to normalize `url` for
  JSON-LD (site config first, then `public.appUrl`).
- **`useSeo` emits Open Graph only —** No `twitter:*` meta at all. X reads
  `og:*` when no `twitter:` tag is present, and Unhead 3 reports every
  `twitter:*` name (including `twitter:card`) as deprecated, which turns the
  shared browser-console contract red on every route (narduk-libs#349). `useSeo`
  declares `og:image:width` / `og:image:height` alongside a static `image` —
  1200x630 by default, overridable with `imageWidth` / `imageHeight` — because
  Unhead also warns on an `og:image` without dimensions.
  `NUXT_PUBLIC_TWITTER_SITE` is still accepted as public runtime config but is
  no longer read by anything.

## Admin OG route previews (SSR HTML)

For dashboards that list every **live** `og:image` resolved from public routes
(for example product or blog PDPs), the layer ships:

- `GET /api/admin/og-image-previews` — **admin-only**; returns `{ groups }`
  where each entry includes `imageSrc` from parsed HTML (prefers `/_og/` when
  duplicate metas exist). The default handler lists the home page plus a static
  `/og.png` row; **override** `server/api/admin/og-image-previews.get.ts` in
  your app to register your own routes and template notes.
- `useAdminOgImagePreviews()` — client fetch helper for that endpoint.
- `AdminOgImageRouteGroups` — optional UI to render grouped cards (copy URL,
  link to route and optional `adminPath`).

Import the component from the layer package export path or rely on Nuxt
auto-import when the SEO layer is extended. Pair with `defineOgImage()` on your
pages and Takumi templates (`.takumi.vue`) as documented in nuxt-og-image.

## Takumi-safe OG template CSS

Takumi is stricter than browser CSS. Keep OG templates conservative and validate
new templates through the preview lab or admin route preview before publishing:

- Prefer explicit pixel dimensions, flexbox, inline style objects, and simple
  `linear-gradient(...)` / `radial-gradient(circle, ...)` backgrounds.
- Avoid advanced radial-gradient shape and position syntax such as
  `radial-gradient(ellipse 90% 80% at 20% 10%, ...)`; Takumi can reject those
  values at render time even when Chrome accepts them.
- Avoid relying on external CSS, CSS variables that are not resolved in the
  style object, pseudo-elements, filters, backdrop filters, masks, or complex
  layout features.
- Keep reusable dynamic values normalized before they reach the template; pass
  complete colors and strings instead of expecting browser-like fallback
  behavior.

The stock `OgImageDefault.takumi.vue` and `OgImageArticle.takumi.vue` components
are the supported baseline for safe gradients and layout patterns. If an app
adds custom Takumi components, include at least one public route in
`/api/admin/og-image-previews` so the dashboard resolves the real signed
`/_og/...` URL from SSR HTML instead of checking only manual preview inputs.
