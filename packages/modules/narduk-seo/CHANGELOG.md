# @narduk-enterprises/narduk-seo

## 2.7.2

### Patch Changes

- d0a4ba0: `useLocalBusinessSchema` now emits its `openingHours` strings (the
  schema.org text form, `'Mo-Fr 09:00-17:00'`) under `openingHours`. They used
  to land under `openingHoursSpecification`, whose range is structured
  `OpeningHoursSpecification` objects, so every page that passed opening hours
  shipped invalid LocalBusiness JSON-LD (narduk-libs#944). The option type is
  now exported as `LocalBusinessOptions`.

## 2.7.1

### Patch Changes

- dc6be99: The default social image plugin no longer throws from its `useHead`
  getter (narduk-libs#874). An app with `defaultOgImage` and no usable site URL
  (unset, unparsable, or plain HTTP on a public host) used to fail SSR on every
  page. It now renders the page without the default `og:*` tags and logs one
  `[narduk-seo] Default social metadata skipped: …` warning per process.
  `defaultSocialMeta()` itself still rejects unsafe input, now with a clear
  message when the site URL is missing.

## 2.7.0

### Minor Changes

- 1dc62db: `@narduk-enterprises/narduk-seo/shared/hostAwareIndexing` exports
  `canonicalRobotsPolicy(hostname, canonicalHostname, options)`, which returns
  the full robots directive for a request host:
  `'index, follow, max-image-preview:large'` (exported as `hostAwareIndexRule`)
  on the canonical host and `'noindex, nofollow'` everywhere else. Options cover
  route-level `indexable: false`, `additionalCanonicalHostnames` for aliases
  such as `www.`, and overrides for both directive strings. Apps that carry
  their own `robotsForHostname` and hardcoded canonical hostname can use it
  instead (narduk-libs#836).

### Patch Changes

- 408ad37: README only: point secret-backed local flows at nvault instead of
  Doppler, which is retired except the `ne` root store. `create-narduk-app`
  releases alongside because it pins both packages.
- 8affc4a: narduk-seo no longer hard-depends on nuxt-og-image. The package is an
  optional peer at 6.8.0. Static-card apps omit it and set
  `ogImage.enabled: false`. Runtime OG or build-time prerender cards
  (`ogImage.zeroRuntime: true`) add `nuxt-og-image@6.8.0` themselves --
  `zeroRuntime` still installs the module and only disables the request-time
  renderer. If the peer is missing, the layer skips `installModule`, registers a
  no-op `defineOgImage`, and `useSeo` falls back to the static image. A missing
  peer is a silent skip on the default/static path and when the app set only
  `ogImage.zeroRuntime: true`; the layer warns only when the app set
  `ogImage.enabled: true`. Generated SEO apps pin `nuxt-og-image@6.8.0` so the
  default `useSeo()` path still produces `/_og/` cards (narduk-libs#316).

  The three image-size highs that originally filed narduk-libs#170 are already
  gone at nuxt-og-image 6.8.0 (`image-size` is not in the lockfile). This change
  is the coupling half.

  On npm.pkg.github.com / npm.nard.uk the abbreviated packument drops
  `peerDependenciesMeta`, so an optional peer can still install as required
  (package-delivery#7). The module skip is what keeps a consumer that does not
  have the package able to build. Whether the install tree is actually free of
  nuxt-og-image depends on the registry's packument until the npmjs.org move.

## 2.6.0

### Minor Changes

- d8aec20: narduk-seo no longer ships its own copy of `LayerAppFooter`
  (narduk-libs#743). It registers `LayerNetworkFooter` globally and adds it to
  `appConfig.nardukCore.footer.after`, so narduk-core's footer renders the
  network row. The footer an app sees is unchanged. This needs narduk-core
  2.11.0 or later, and the peer range now says so.

## 2.5.3

### Patch Changes

- bad1b0d: `LayerAppFooter.vue` now carries a justified inline disable for the
  new `narduk/no-shadowed-shared-component` rule. The component is a deliberate
  fork of narduk-core's footer, kept only to render `<LayerNetworkFooter />`,
  and narduk-libs#743 replaces it with a core slot. Runtime behaviour is
  unchanged.

## 2.5.2

### Patch Changes

- c99908b: A `nardukSeo.aiCrawlers` group that names crawlers to **allow** now
  repeats the wildcard group's `disallow` paths, including narduk-seo's
  non-public routes. A crawler obeys only the most specific group naming it (RFC
  9309), so `{ allow: ['GPTBot'] }` used to emit `User-agent: GPTBot` /
  `Allow: /` and open every path the `*` group disallows to GPTBot alone.
  `'allow'`, `'disallow'`, and `disallow` lists are unchanged.
- 5ac629e: The package's `volta.node` pin moves from 22.22.3 to 24.21.0, the
  Node the workspace root and CI run (narduk-libs#647). No runtime change: the
  pin only selects the Node that Volta runs for commands inside the package
  directory. It now matches the ABI of the native modules that the root install
  builds.

## 2.5.1

### Patch Changes

- e61a56d: `meta.compatibility.nuxt` now says `>=4.0.0`, matching the `nuxt`
  peer range these modules already declare (#444). Before, the module metadata
  still claimed `>=3.16.0`, so a Nuxt 3 app got no compatibility warning from
  Nuxt and failed later instead. Nuxt 4 apps see no change.

## 2.5.0

### Minor Changes

- c7a6b59: Declare `narduk-core` as a peer range instead of an exact-pinned
  dependency.

  Both packages carried `@narduk-enterprises/narduk-core` as `workspace:*` in
  `dependencies`, which publishes as an exact pin. An app upgrading narduk-core
  therefore kept a second, older copy alive underneath these two — and
  narduk-core is a Nuxt module that appends global CSS to `nuxt.options.css`, so
  which copy's stylesheet wins comes down to module resolution order rather than
  anything the app declares.

  `narduk-core` now sits in `peerDependencies` at `>=2.6.3 <3.0.0` with a
  `workspace:*` `devDependencies` entry for these packages' own builds and
  tests, matching `narduk-uploads`. The consuming app owns the single resolved
  version.

  Released as a minor rather than a patch because it changes the published
  manifest shape: an app that reached narduk-core only transitively through
  these packages must now resolve it itself. Every generated app already
  declares narduk-core directly — it is the first entry in the generator's Nuxt
  `modules` list — and pnpm and npm both auto-install a missing peer, so no
  estate app is expected to need a change.

- 1dbf07f: Add `useDatasetSchema` for schema.org `Dataset` JSON-LD.

  Pages that publish a data series — a buoy station, a gauge, a catalog of
  readings — had no way to describe it as a dataset, so Google Dataset Search
  and the AI-discovery surfaces that read the same markup saw only a `WebPage`.

  `useDatasetSchema({ name, variableMeasured, temporalCoverage, distribution, license, creator, ... })`
  emits a `Dataset` node in the established shape of the other schema helpers in
  this package: auto-imported, `MaybeRefOrGetter` input, and every optional
  field omitted rather than emitted empty.

  `variableMeasured` takes either a bare string or
  `{ name, unitText, unitCode, minValue, maxValue, description }` and becomes
  `PropertyValue` nodes; `distribution` becomes `DataDownload` nodes and drops
  entries with no `contentUrl`; `creator` defaults to an `Organization` and
  accepts `Person`; and `includedInDataCatalogUrl` becomes a `DataCatalog` node.

- 0f43a24: Stop pinning `/_og/**` to `prerender: false`, so OG images for
  prerendered pages are actually generated (narduk-libs#170).

  `nuxt-og-image` emits an _unsigned_ `/_og/s/...` URL while a page is
  prerendered and relies on the prerender crawler to bake that image to a file.
  The pin stopped the file being produced, so the unsigned URL fell through to
  the runtime handler, which rejects it with `403 Missing URL signature` as soon
  as a signing secret is configured -- which every deployed build requires. SSR
  pages were never affected; they take the signed `/_og/d/...` branch.

  **This changes your build output.** Each prerendered page that renders a card
  now writes one image file into the app's static assets, counting against the
  Workers per-file size and total file-count ceilings, and build time grows with
  the number of such pages. A baked card is exactly as stale as the page it was
  built from, so a card that must track data moving between deploys does not
  belong on a prerendered route. Apps that ship only a static `defaultOgImage`
  are unaffected; set `ogImage.zeroRuntime: true` or `ogImage.enabled: false` as
  before.

## 2.4.14

### Patch Changes

- Updated dependencies [693f7d3]
  - @narduk-enterprises/narduk-core@2.7.0

## 2.4.13

### Patch Changes

- Updated dependencies [fa2f123]
  - @narduk-enterprises/narduk-core@2.6.4

## 2.4.12

### Patch Changes

- Updated dependencies [ecc731b]
  - @narduk-enterprises/narduk-core@2.6.3

## 2.4.11

### Patch Changes

- 6d44a92: Fall back to the page's own route when a canonical is refused,
  instead of to the site root. `resolveSafeCanonicalUrl` still refuses
  protocol-relative values, backslash smuggling and cross-origin absolutes —
  that part was right — but it answered the site root, so an app handing
  `useSeo` a `http://localhost:3000/...` absolute (what
  `runtimeConfig.public.siteUrl` resolves to wherever `SITE_URL` is unset) made
  every page on the site declare the root as its own `canonical` and `og:url`.
  Valid, plausible, and wrong everywhere at once; it shipped to production in
  LakeStat and was caught only by a live preview check. The route is the one
  thing the refused value and the page agreed on, so it is the fallback; the
  site root remains the last resort. In development a refusal now warns and
  names both sides.

## 2.4.10

### Patch Changes

- Updated dependencies [81051b0]
  - @narduk-enterprises/narduk-core@2.6.2

## 2.4.9

### Patch Changes

- Updated dependencies [448e86f]
- Updated dependencies [7142305]
  - @narduk-enterprises/narduk-core@2.6.1

## 2.4.8

### Patch Changes

- Updated dependencies [4599aa7]
- Updated dependencies [4ba5d02]
  - @narduk-enterprises/narduk-core@2.6.0

## 2.4.7

### Patch Changes

- 92835a1: Fixes for the new error-severity lint rules. `LayerAppFooter`
  (narduk-core, narduk-seo) no longer reads `new Date()` during render for the
  copyright year; it reads one SSR-hydrated timestamp (`useSsrNow` in
  narduk-core, `useState` in narduk-seo), so server and client agree.
  `GET /api/auth/api-keys` (narduk-auth) is ordered newest first in SQL and
  limited to 100 keys, since nothing caps how many keys a user may create.
- Updated dependencies [8d35cb8]
- Updated dependencies [8d35cb8]
- Updated dependencies [8d35cb8]
- Updated dependencies [92835a1]
  - @narduk-enterprises/narduk-core@2.5.0

## 2.4.6

### Patch Changes

- Updated dependencies [bb37590]
- Updated dependencies [bb37590]
  - @narduk-enterprises/narduk-core@2.4.0

## 2.4.5

### Patch Changes

- Updated dependencies [8da7e33]
- Updated dependencies [05b3ef9]
  - @narduk-enterprises/narduk-core@2.3.0

## 2.4.4

### Patch Changes

- Updated dependencies [fe58c5f]
  - @narduk-enterprises/narduk-core@2.2.4

## 2.4.3

### Patch Changes

- Updated dependencies [7ae9278]
  - @narduk-enterprises/narduk-core@2.2.3

## 2.4.2

### Patch Changes

- Updated dependencies [766ce96]
  - @narduk-enterprises/narduk-core@2.2.2

## 2.4.1

### Patch Changes

- Updated dependencies [fa41027]
- Updated dependencies [fa41027]
  - @narduk-enterprises/narduk-core@2.2.1

## 2.4.0

### Minor Changes

- 31a43a7: Correct published packaging declarations so they match what these
  packages already require at install time. This is not a runtime change.

  Nine Nuxt modules already depend on `@nuxt/kit` `^4.0.0`, which does not run
  on Nuxt 3, but advertised `peerDependencies.nuxt` as `>=3.16.0`. The peer is
  now `>=4.0.0`, matching narduk-shell and narduk-mapkit-nuxt. `narduk-core` and
  `narduk-realtime` also raise `@nuxt/schema` to `>=4.0.0` so it matches `nuxt`.
  `narduk-core` and `narduk-analytics` add exact `./app/types/*` entries for the
  `.ts` files that the `*.d.ts` export pattern could not resolve. The analytics
  key exports runtime `const`s, so it carries `types` then `import` then
  `default`. Core `./app/types/api` stays types-only because that file is
  interfaces. `narduk-app` declares `zod` `^4.4.3` as an optional peer (kept in
  `devDependencies`) so consumers that typecheck `./server/request-body` can
  resolve `z.ZodType` without warning HTTP-only consumers. `narduk-shell`
  tightens `vue-router` to `^5.3.1` so the published package matches `@nuxt/ui`
  `4.8.1` and the workspace override.

  ## Operator action

  The Nuxt 4 peer (`nuxt` and, where declared, `@nuxt/schema`) is a
  consumer-visible floor raise, so the nine modules that advertised Nuxt 3 ship
  as `minor`. Every narduk-app in the estate is already on Nuxt 4; Buoys is on
  4.5.2. A remaining Nuxt 3 app cannot take this release — and already could not
  run these modules, because they depend on `@nuxt/kit` `^4.0.0`.
  `create-narduk-app` is a companion patch so generator pins move with the
  minors. `narduk-app` (optional zod peer) and `narduk-shell` (vue-router
  already at UI 4.8.1) stay `patch`.

- 96d1d4b: Add opt-in RFC 9116 `security.txt` and an `aiCrawlers` policy on top
  of the existing `@nuxtjs/robots` groups.

  `nardukSeo.securityTxt` stays off until the app sets `contact` — the package
  never invents a reporting address. When contact is set, the module bakes
  `Expires` as build time plus `expiresDays` (default 365, max 365) and serves
  the body at `/.well-known/security.txt` and `/security.txt` as
  `text/plain; charset=utf-8`. Enabling the option without a contact is a
  build-time error.

  `nardukSeo.aiCrawlers` defaults to `'allow'` and emits no extra robots groups,
  so existing apps keep the same robots.txt. `'disallow'` and
  `{ allow, disallow }` add groups for the exported `AI_CRAWLERS` list (GPTBot,
  ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-Web, anthropic-ai,
  Google-Extended, PerplexityBot, CCBot, Bytespider, Amazonbot,
  Applebot-Extended, meta-externalagent, cohere-ai).

  `securityTxt` field values (`contact`, `canonical`, `policy`,
  `acknowledgments`, `preferredLanguages`) reject embedded `\r`/`\n` with a
  build-time error — security.txt is one field per line, so a line break could
  otherwise inject an extra field. The served route also logs one `console.warn`
  per isolate when `Expires` is at or within 30 days of passing, since the value
  is baked in at build time and never refreshes on its own.

### Patch Changes

- 384925d: Require a stable OG signing secret, and stop protocol-relative paths
  from poisoning `og:url` / canonical.

  **OG images.** With no `security.secret`, `nuxt-og-image` auto-generates one
  per build, so every previously signed `/_og/d/<params>.png` URL stops
  verifying: a rolling Worker release serves two secrets at once and cached
  signed URLs 403 until they are regenerated. Signing is resolved at build time,
  so the secret belongs in a Workers Builds Build variable rather than a runtime
  Worker secret. Non-dev builds that still enable runtime generation now fail
  unless `NUXT_OG_IMAGE_SECRET` is a non-empty value (whitespace does not
  count). `nuxt dev` and `nuxt prepare` stay permissive. Operators: set
  `NUXT_OG_IMAGE_SECRET` in every deployed environment, or set
  `ogImage.enabled: false` / `ogImage.zeroRuntime: true` if the app only uses
  the static `defaultOgImage`. The committed CI placeholder
  (`narduk-test-only-og-image-secret-000000`) is rejected on any build the
  estate deploys -- Workers Builds (`WORKERS_CI` / `WORKERS_CI_BRANCH`) and a
  local `wrangler deploy` behind `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY` -- so it
  cannot sign a live Worker. Builds that produce nothing deployable (`nuxt dev`,
  GitHub Actions `build:ci`, packed-consumer fixture apps) may still use it.

  **Canonical URLs.** `new URL('//attacker.example', site)` was accepted as
  HTTPS with no userinfo. Router paths and explicit `canonicalUrl` values are
  now sanitized to a same-origin path (or a same-origin absolute URL) before
  resolution; poisoned input falls back to `/` and never throws.

- Updated dependencies [f08deca]
- Updated dependencies [d148560]
- Updated dependencies [384925d]
- Updated dependencies [384925d]
- Updated dependencies [cfa085f]
- Updated dependencies [3ae6e51]
- Updated dependencies [77945b9]
- Updated dependencies [31a43a7]
- Updated dependencies [384925d]
  - @narduk-enterprises/narduk-core@2.2.0

## 2.3.0

### Minor Changes

- b59907e: Emit Open Graph only: `useSeo` and the default social-image plugin no
  longer render `twitter:card`, `twitter:title`, `twitter:description`,
  `twitter:image`, `twitter:image:alt` or `twitter:site`. X reads `og:*` when no
  `twitter:` tag is present, and Unhead 3 reports every `twitter:*` meta name —
  `twitter:card` included — as deprecated, which turned the shared
  browser-console contract red on every route of every consumer
  (narduk-libs#349, narduk-enterprises/buoys#111).

  `useSeo` now also declares `og:image:width` / `og:image:height` alongside a
  static `image`, defaulting to the 1200x630 card and overridable with the new
  `imageWidth` / `imageHeight` options; Unhead warns on an `og:image` with no
  declared dimensions, and the generated-image path already declares its own.

  `NUXT_PUBLIC_TWITTER_SITE` and `runtimeConfig.public.twitterSite` are still
  accepted so existing deployments keep booting, but nothing reads them; the
  field is marked `@deprecated`. The internal helper
  `app/utils/resolvePublicTwitterSite.ts` is removed with its only caller.

  The module now also stops its bundled dependencies from re-adding the tags
  `useSeo` gave up. It sets `seo.automaticTwitterTags: false`, so
  nuxt-seo-utils' `InferSeoMetaPlugin` no longer pushes a low-priority
  `twitter:card` into every head while keeping its Open Graph inference, and
  `ogImage.includeTwitter: false`, so nuxt-og-image stops emitting
  `twitter:card`, `twitter:image`, `twitter:image:src`, `twitter:image:width`,
  `twitter:image:height` and `twitter:image:alt` next to each generated
  `og:image`. Both are plain `defu` defaults, so an app that wants the tags back
  can set either option to `true`.

### Patch Changes

- Updated dependencies [9051c12]
- Updated dependencies [97b0ac3]
- Updated dependencies [fff943d]
- Updated dependencies [57ba098]
- Updated dependencies [b94ac04]
- Updated dependencies [894cd17]
- Updated dependencies [57ba098]
  - @narduk-enterprises/narduk-core@2.1.0

## 2.2.0

- Keep the host-aware page indexing plugin out of internal component islands.
  Dynamic OG images on preview hosts now render successfully while page metadata
  and response headers retain `noindex, nofollow` protection.

### Minor Changes

- 8abb3c8: Move the bundled Nuxt SEO modules to one coordinated set that
  supports both Unhead 2 (Nuxt 4.4) and Unhead 3 (Nuxt 4.5): `@nuxtjs/robots`
  6.2.3, `@nuxtjs/sitemap` 8.5.1, `nuxt-link-checker` 5.3.0, `nuxt-og-image`
  6.8.0, `nuxt-schema-org` 6.3.2, `nuxt-seo-utils` 8.5.1 and `nuxt-site-config`
  4.2.3. The set no longer installs `image-size`, `@unhead/addons` or
  `@unhead/schema-org`.

  To adopt it, remove app overrides that pin `nuxt-seo-utils`, `nuxt-og-image`,
  `@nuxtjs/seo` or `nuxtseo-shared` to older releases. If the app imports
  `#sitemap/types`, set its own `@nuxtjs/sitemap` to 8.5.1.

  Rendered head changes to expect, all verified against a real app on Nuxt 4.4.8
  and on Nuxt 4.5.2:

  - `nuxt-seo-utils` 8.5 defaults to `minify: { build: true, runtime: false }`,
    so head content injected at runtime (for example Nuxt UI's inline color
    styles) is no longer minified in the SSR response. Set
    `seo: { minify: true }` to keep the old behaviour.
  - `nuxt-seo-utils` 8.5 emits the full favicon set it discovers, with `type`
    and `sizes` attributes, rather than only `apple-touch-icon`.
  - `nuxt-schema-org` 6.3.2 no longer emits a second `#organization` node beside
    the `#identity` one. Assertions that matched the duplicate need updating.
  - `nuxt-seo-utils` 8.5 runs its `treeShakeUseSeoMeta` transform only on Unhead
    3; on Unhead 2 it logs that it skipped the transform.
  - `nuxt-seo-utils` 8.5 adds a build-time head validator that can report
    malformed or duplicate head tags.

  OG image preview paths now carry the signature `nuxt-og-image` verifies, so
  signed previews load when `security.secret` is set. Values containing `*` are
  encoded the way `nuxt-og-image` 6.8.0 encodes them.

### Patch Changes

- Updated dependencies [8f693b1]
- Updated dependencies [8abb3c8]
  - @narduk-enterprises/narduk-core@2.0.0

## 2.1.1

### Patch Changes

- Updated dependencies [2e9d424]
  - @narduk-enterprises/narduk-core@1.25.0

## 2.1.0

### Minor Changes

- fb0c50c: Add app-owned social preview generation and validation: default
  artwork, explicit route coverage, initial HTML checks, crawler image
  downloads, and distinct dynamic route images. The SEO module gains an opt-in
  global static fallback and canonical OG URLs, with explicit previews for
  public noindex pages. New scaffolds include artwork sources, metadata, route
  inventory, build gates, and crawler acceptance. Existing apps opt in through
  the migration guide; no fleet synchronization occurs.

### Patch Changes

- Updated dependencies [548fa01]
- Updated dependencies [960479a]
- Updated dependencies [54577ac]
- Updated dependencies [0f45d4b]
- Updated dependencies [fdb9c15]
- Updated dependencies [3a2b7b0]
- Updated dependencies [d606e70]
  - @narduk-enterprises/narduk-core@1.24.0

## 2.0.10

### Patch Changes

- e202cfd: Disable analytics identifiers, loading, and replay on noncanonical
  Workers/Pages preview hosts and explicit nonproduction deployments. The same
  immutable version keeps production analytics when promoted to its canonical
  hostname.

  Avoid a client lifecycle warning while retaining noindex robots metadata on
  noncanonical hosts.

- Updated dependencies [e202cfd]
- Updated dependencies [37c03e2]
  - @narduk-enterprises/narduk-core@1.23.2

## 2.0.9

### Patch Changes

- Updated dependencies [aaf5549]
  - @narduk-enterprises/narduk-core@1.23.1

## 2.0.8

### Patch Changes

- Updated dependencies [6297a08]
  - @narduk-enterprises/narduk-core@1.23.0

## 2.0.7

### Patch Changes

- Updated dependencies [def589f]
  - @narduk-enterprises/narduk-core@1.22.0

## 2.0.6

### Patch Changes

- Updated dependencies [0f2262a]
- Updated dependencies [8b48dba]
  - @narduk-enterprises/narduk-core@1.21.0

## 2.0.5

### Patch Changes

- Updated dependencies [d6e098e]
  - @narduk-enterprises/narduk-core@1.20.5

## 2.0.4

### Patch Changes

- Updated dependencies [1d017c7]
  - @narduk-enterprises/narduk-core@1.20.4

## 2.0.3

### Patch Changes

- @narduk-enterprises/narduk-core@1.20.3

## 2.0.2

### Patch Changes

- 95ec690: `@narduk-enterprises/eslint-config` v2: the estate lint config moves
  into narduk-libs (per HB-10 / D-DEMOTE-1 and narduk-libs#50), rebuilt for
  ESLint 10 on a replace-by-default basis — maintained third-party plugins
  wherever they cover the intent, 45 bespoke rules surviving out of 103 (every
  one with tests and no `testMode` bypasses), the proven-inverted hydration
  rules and dead Nitro security gates rebuilt against the executed deep-review
  proofs, legacy presets and the frozen nuxt-ui spec tier removed, and every
  code-corrupting autofixer gone. Consumer API (`createAppLintConfig`,
  `composeSharedConfigs`, the 14 capability packs) is signature-compatible;
  adopting v2 requires ESLint `^10` (peer). License corrected to UNLICENSED
  (D-PKG-5).

  **Three consumer-visible tightenings** land with the adversarial-hardening
  pass (full account in `DESIGN.md`):

  1. **Pack globs are nesting-safe.** `server/**`, `workers/**` and the auth
     pack's globs now match at any depth. A repository linted from an outer
     `cwd` — any monorepo, any app one level down, and every layer package's
     `runtime/server/**` — previously received **no** server or Cloudflare rules
     at all. Expect first-time findings in newly-covered trees. The two core
     rules the packs carry are gated out of `tests/**` and friends so the
     widening does not sweep in test code.
  2. **A route named like a test is a route.** `server/api/x.post.test.ts` is
     deployed by Nitro as `POST /api/x.post.test`, and the `.test.` infix no
     longer exempts it from the security tier. Inside a route tree only a real
     test or fixture _directory_ exempts a file. Move colocated route suites
     under `tests/` or `__tests__/`.
  3. **`no-restricted-imports` is order-independent.** All three contributing
     packs now assign one shared option, so a trailing `cloudflare` entry can no
     longer erase the relative-import and layer-source patterns — which it did
     for every consumer using `nardukTemplateStrictCapabilityPacks`. Those
     patterns start applying again. A portable Nuxt layer (no `#server/*` alias
     for its own sources) should assign the new
     `PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE` export to its server glob rather
     than switching the rule off.

  Also fixed in the same pass: five ways to walk past a security rule by
  renaming a binding (an aliased `defineEventHandler`, a runtime-derived HTTP
  method, `.raw` lifted off drizzle's `sql`, a destructured `db.query` receiver,
  and `limit: undefined`), and `no-legacy-overlay-model`'s blindness to
  camelCase `modelValue` bindings. Every one ships with the fixture that proved
  it as a regression test.

  Sibling packages: the shared config is now consumed via the workspace
  (`workspace:*`) and their `eslint` devDependency moves to `^10.8.0`. Adopting
  v2 also swept their stale `eslint-disable` comments onto the replacement rule
  ids and cleared the findings the fixed path gates newly surface. Three
  behaviour-neutral source edits came with that sweep: `narduk-core` adds
  `import.meta.client` early returns to three handlers that were already
  client-only (clipboard copy, share-link copy, avatar canvas resize);
  `narduk-auth`'s `runtime-public` endpoint drops a `process.env` merge layer
  that `readWorkerRuntimeEnv` already supplied and that the merge order
  discarded; and `narduk-app-tools` swaps one `split().join()` for
  `replaceAll()`. The five layer packages (`narduk-core`, `-auth`, `-seo`,
  `-ai`, `-uploads`) assign the portable-layer import rule in their own configs,
  and `narduk-core` and `-uploads` carry scoped, commented exceptions for the
  pre-existing conditions their newly-linted `runtime/server/**` trees surfaced.

- Updated dependencies [95ec690]
  - @narduk-enterprises/narduk-core@1.20.2

## 2.0.1

### Patch Changes

- Updated dependencies [e030789]
  - @narduk-enterprises/narduk-core@1.20.1

## 2.0.0

### Major Changes

- 256c696: seo: make the Narduk network directory endpoint injectable with no
  default

  The network directory endpoint is now supplied by the consuming app through
  `nardukSeo.networkDirectoryUrl` (or `NUXT_PUBLIC_NARDUK_NETWORK_DIRECTORY_URL`
  at runtime) and has **no built-in default**. When it is unset the feature
  disables itself: `/api/narduk-network/sites` performs no outbound fetch,
  `useNardukNetworkDirectory()` skips its request, `/narduk-network` renders an
  empty directory, and `LayerNetworkFooter` omits the directory link. Failing
  quiet is deliberate — the directory is a marketing cross-link surface, not a
  gate.

  Previously the endpoint was derived from a package-owned catalog hostname, so
  every app installing this package polled a host it never chose. A published
  library must not pin its consumers to one origin.

  BREAKING CHANGES:

  - `NARDUK_DEFAULT_CATALOG_BASE_URL` is no longer exported.
  - `resolveNardukNetworkDirectoryUrl(value)` now takes the full directory URL
    (not a catalog base URL) and returns `null | string` instead of `string`.
  - `resolveNardukCatalogBaseUrl(value)` returns `null | string` instead of
    falling back to a hardcoded hostname.
  - `/api/narduk-network/sites` responses gained `configured: boolean`, and
    `catalogUrl` / `directoryUrl` may now be `null`.
  - Apps that want `/narduk-network` populated must set the new option;
    upgrading without setting it turns the directory off rather than repointing
    it.

### Patch Changes

- e4c8262: Replace implicit reliance on `narduk-core`'s Nuxt auto-imports
  (`useAppFetch`, `formatBuildTimeLocal`, `useLogger`, `requireAdmin`) with
  explicit imports from `@narduk-enterprises/narduk-core/*` subpaths.

  These composables/utils were previously called as bare globals, which only
  resolves when a consuming app registers `narduk-core`'s Nuxt module with its
  default options (`app: true`). A consumer that narrows the module surface (for
  example `{ app: false, server: true }`, used by `spacex-ipo` to avoid a
  component-registration collision with `narduk-seo`'s own `LayerAppFooter`)
  fails `nuxt typecheck` with `Cannot find name 'useAppFetch'` the moment it
  also depends on `narduk-seo` or `narduk-auth`, because those packages'
  composables/components still assumed the global was present.

  No behavior change: each site now imports the exact same function it was
  already calling implicitly.

  Bump `create-narduk-app` in step so its generated-app pins for `narduk-seo`,
  `narduk-auth`, and `narduk-analytics` refresh to these patched versions.

## 1.21.0

### Minor Changes

- 0783806: Add host-aware runtime indexing (`hostAwareIndexing` module option /
  `NARDUK_SEO_HOST_AWARE_INDEXING` env). Production-target builds that opt in
  ship a runtime guard — a nitro middleware plus an app plugin — that serves
  `noindex, nofollow` (response header and robots meta) on any non-canonical
  request host, such as an immutable route-free `workers.dev` preview alias,
  while the canonical site host stays fully indexable. This enables the
  build-once contract where one exact Worker version is preview-safe on its
  preview URL and indexable on the production domain, instead of baking noindex
  into a separate preview build. Non-production deployment targets are unchanged
  (the existing build-time noindex safety still applies), and the feature is off
  by default.

### Patch Changes

- 0783806: Restore a warning-free packed consumer install after upstream Nuxt
  4.5 drift.

  `nuxt-og-image` moves from 6.7.2 to 6.7.4. 6.7.2 pinned `oxc-parser@^0.138.0`,
  which cannot satisfy the `oxc-parser@>=0.140.0` optional peer that `unctx@3`
  declares once `@nuxt/kit@4.5.0` is resolved, so a Nuxt-less external consumer
  install emitted an unmet-peer warning.

  The generated app now pins `@nuxt/kit` to its exact `nuxt` version, and pins
  `nuxt-og-image` to the 6.7.2 release built for that `@nuxt/kit`. The generator
  pins `nuxt` exactly while the Narduk modules depend on `@nuxt/kit@^4.0.0`, so
  before this the app resolved a `@nuxt/kit` newer than its own `nuxt` as soon
  as upstream published a Nuxt minor, and inherited that kit's transitive
  dependency block instead of the one its pinned Nuxt was built with.

## 1.20.0

### Minor Changes

- 7848187: Remove template composition and Command-only contracts from
  `narduk-platform`, retire core PWA and control-plane behavior, and source the
  SEO network directory from the independent catalog origin.

### Patch Changes

- 7848187: Keep known VueUse 14.3 annotation noise out of production build logs
  without hiding app-source warnings, and make packaged SEO routes and Takumi
  rendering self-contained in downstream Nuxt consumers.
- Updated dependencies [7848187]
- Updated dependencies [7848187]
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-core@1.20.0
