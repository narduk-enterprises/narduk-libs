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
- **`useSeo` + `NUXT_PUBLIC_TWITTER_SITE` —** When this public string is
  non-empty, `useSeo` also sets `twitter:site` (X/Twitter site attribution) for
  all pages that call the composable.

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
