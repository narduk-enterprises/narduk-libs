# @narduk-enterprises/narduk-uploads

## 1.21.3

### Patch Changes

- e61a56d: `meta.compatibility.nuxt` now says `>=4.0.0`, matching the `nuxt`
  peer range these modules already declare (#444). Before, the module metadata
  still claimed `>=3.16.0`, so a Nuxt 3 app got no compatibility warning from
  Nuxt and failed later instead. Nuxt 4 apps see no change.

## 1.21.2

### Patch Changes

- b876392: `POST /api/upload` identifies each file from its magic bytes instead
  of trusting the multipart part's client-supplied type (DR-DATA-7). A file
  whose bytes are not PNG, JPEG, GIF, WebP or AVIF, such as HTML or SVG labelled
  `image/png`, is refused with 415 before anything is written to R2. The stored
  content type and key extension come from the bytes. New export:
  `sniffUploadImageType` from `./server/utils/upload`.

## 1.21.1

### Patch Changes

- a1efa4e: `POST /api/upload` now holds the 100 MB request cap while the body is
  **read**, not only against the declared `Content-Length`.

  Before this, the cap was enforced in two places that both miss on Cloudflare
  Workers — the only runtime Narduk apps deploy to.
  `rejectOversizedUploadRequest` trusts the `Content-Length` header, and
  `capIncomingMessageBytes` listens for `data` events on `event.node.req`, which
  on Workers is a `node-mock-http` `IncomingMessage` that never emits any. A
  client that declared a small `Content-Length` and then sent 500 MB passed both
  and was buffered in full before the multipart parse.

  `enforceUploadBodyByteCap(event, maxBytes)` now runs before that parse and
  resolves the body the same way h3 does. A web `ReadableStream` is read through
  a counting reader that aborts with 413 the moment the cap is passed — the
  overflowing chunk is dropped, no further chunk is pulled, and the source is
  cancelled so the Worker stops reading. Bytes the runtime already materialised
  (the shape Nitro's `cloudflare_module` handler produces) are measured and
  refused with 413 before the parse. A live Node request stream is untouched and
  still owned by `capIncomingMessageBytes`.

  No behaviour change for uploads inside the cap. The 411 on a missing or
  non-finite `Content-Length` and the Node hard-stop from the previous release
  are unchanged, and both are now pinned by tests. `enforceUploadBodyByteCap`
  and `readCappedWebStream` are additive exports of
  `@narduk-enterprises/narduk-uploads/server/utils/upload`; nothing existing
  changed shape.

## 1.21.0

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

### Patch Changes

- 8186003: Serve `GET /images/**` only for the same raster MIME allow-list as
  `POST /api/upload`.

  `X-Content-Type-Options: nosniff` does not stop a stored `text/html` or
  `application/javascript` object from executing on the first-party origin. The
  public image route now fail-closes on any stored content type outside
  `image/jpeg|png|webp|gif|avif` (including missing metadata and SVG).

  `POST /api/upload` now fail-closes on a missing or non-finite `Content-Length`
  (411) and hard-stops the Node request stream at the 100 MB request cap so a
  lying header cannot buffer the whole body.

## 1.20.0

### Minor Changes

- 8abb3c8: Accept narduk-core 2 as a peer. The `@narduk-enterprises/narduk-core`
  peer range widens from `>=1.19.15 <2.0.0` to `>=1.19.15 <3.0.0`.
  narduk-uploads does not use Pinia, so narduk-core 2's move to Pinia 4 does not
  affect it. Apps still on narduk-core 1 can keep taking narduk-uploads updates.

## 1.19.19

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
