# @narduk-enterprises/narduk-ai

## 0.3.0

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

## 0.2.3

### Patch Changes

- Updated dependencies [9051c12]
- Updated dependencies [97b0ac3]
- Updated dependencies [fff943d]
- Updated dependencies [57ba098]
- Updated dependencies [b94ac04]
- Updated dependencies [894cd17]
- Updated dependencies [57ba098]
  - @narduk-enterprises/narduk-core@2.1.0

## 0.2.2

### Patch Changes

- 8f693b1: Pin `@nuxt/ui` at `4.8.1` everywhere the layer pins it: the
  `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest.

  `@nuxt/ui` 4.6.1 added `build.transpile.push('reka-ui')` (nuxt/ui#6286), which
  makes Vite bundle `reka-ui` per importer on the server as well as the client.
  Without it, an app that also declares `reka-ui` directly renders SSR markup
  from its own copy while hydrating against Nuxt UI's pinned copy, which
  produced the `Hydration node mismatch` failures in buoys. 4.8.1 also carries
  the fix for GHSA-gj2h-2fpw-fhv9 (medium, `@nuxt/ui < 4.8.1`) and widens the
  `typescript` peer to `^5.6.3 || ^6.0.0`. The only breaking change between
  4.6.0 and 4.8.1 is `UInputMenu`'s `autocomplete` prop being renamed to `mode`,
  which nothing in this workspace uses.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.8.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy — the duplicate-copy failure this release removes.

- Updated dependencies [8f693b1]
- Updated dependencies [8abb3c8]
  - @narduk-enterprises/narduk-core@2.0.0

## 0.2.1

### Patch Changes

- Updated dependencies [2e9d424]
  - @narduk-enterprises/narduk-core@1.25.0

## 0.2.0

### Minor Changes

- 0f45d4b: Migrate this repo's three list endpoints onto the shared list-query
  contract (`parseListQuery` + `listResponse`, narduk-libs#257). Each route
  keeps its own page ceiling and its own sort allowlist. None of the three
  implements free-text search, so all three declare `searchable: false` and
  answer 400 for a non-empty `q` rather than accepting it and returning an
  unnarrowed page.

  **Compatibility.** Previously-accepted query keys and response fields stay
  accepted / present. New contract fields are additive. Drop the deprecated
  aliases in the next major of each package, once fleet apps read `items`.

  **`GET /api/admin/users`** (narduk-auth)

  - Request: `page` is still accepted and converted to
    `offset = (page - 1) * limit`. `offset` is the new key. Sending both with
    disagreeing values answers 400. `limit` above the route's ceiling of 100 is
    now **clamped to 100** instead of answering 400 (more permissive). `sort`
    accepts `createdAt:asc|desc`, defaulting to `createdAt:desc` (previously the
    descending order was fixed). An unknown key is tolerated (200, with a
    warning logged) for one release rather than answering 400 — see
    `.changeset/list-query-tolerate-unknown-keys.md`.
  - Response: the contract shape `{ items, total, limit, offset, sort, q }` plus
    the deprecated aliases `{ users, page }` so existing consumers keep working.

  **`GET /api/notifications`** (narduk-auth)

  - Request: `unreadOnly` is still any string; only `'true'` filters (the
    pre-contract behaviour). `offset` is now honoured (it was previously
    ignored). An unknown query key is tolerated (200, with a warning logged) for
    one release rather than answering 400. `limit` ceiling stays 100,
    default 50.
  - Response: the contract shape plus the deprecated alias `{ notifications }`.
    `total` is `null` — this route deliberately does not count, which keeps a
    page to a single statement.

  **`GET /api/admin/system-prompts`** (narduk-ai)

  - Request: previously accepted no parameters (extras were ignored). It now
    accepts `limit` (ceiling and default 500), `offset`, and `sort` over `name`
    and `updatedAt`. An unknown query key is tolerated (200, with a warning
    logged) for one release rather than answering 400, so a caller that still
    sends an old ignored parameter keeps working.
  - Response: a bare `AdminSystemPrompt[]` cannot also be a `{ items, … }`
    object, so the wire shape is the contract envelope with `total: null`. The
    bundled `useAdminAi` composable still exposes `AdminSystemPrompt[]` (and
    still accepts a bare array from an older server). No fleet app `$fetch`es
    this route directly (GitHub search, 2026-09-11); stonx, operator-portal and
    riverstatus do not consume it. Ordering is now deterministic (`name:asc` by
    default).

  **Migration (optional).** New callers read `data.items` and page with
  `offset`. Apps using the bundled composables and components
  (`useNotifications`, `useAdminAi`, `AdminUsersTab`) keep their existing public
  shapes.

  **narduk-testkit**'s e2e contracts follow the new shapes and still assert the
  legacy aliases: `expectNotificationList` expects `{ items, notifications }`,
  and the users-api spec accepts `page`, asserts `{ items, users, page }`, and
  checks that `limit=9999` now returns 200 with `limit: 100`.

### Patch Changes

- Updated dependencies [548fa01]
- Updated dependencies [960479a]
- Updated dependencies [54577ac]
- Updated dependencies [0f45d4b]
- Updated dependencies [fdb9c15]
- Updated dependencies [3a2b7b0]
- Updated dependencies [d606e70]
  - @narduk-enterprises/narduk-core@1.24.0
  - @narduk-enterprises/narduk-platform@2.1.0

## 0.1.11

### Patch Changes

- Updated dependencies [e202cfd]
- Updated dependencies [37c03e2]
  - @narduk-enterprises/narduk-core@1.23.2

## 0.1.10

### Patch Changes

- Updated dependencies [aaf5549]
  - @narduk-enterprises/narduk-core@1.23.1

## 0.1.9

### Patch Changes

- Updated dependencies [6297a08]
  - @narduk-enterprises/narduk-core@1.23.0

## 0.1.8

### Patch Changes

- Updated dependencies [def589f]
  - @narduk-enterprises/narduk-core@1.22.0

## 0.1.7

### Patch Changes

- Updated dependencies [0f2262a]
- Updated dependencies [8b48dba]
  - @narduk-enterprises/narduk-core@1.21.0

## 0.1.6

### Patch Changes

- Updated dependencies [d6e098e]
  - @narduk-enterprises/narduk-core@1.20.5

## 0.1.5

### Patch Changes

- Updated dependencies [1d017c7]
  - @narduk-enterprises/narduk-core@1.20.4

## 0.1.4

### Patch Changes

- @narduk-enterprises/narduk-core@1.20.3

## 0.1.3

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

## 0.1.2

### Patch Changes

- Updated dependencies [e030789]
  - @narduk-enterprises/narduk-core@1.20.1

## 0.1.1

### Patch Changes

- Updated dependencies [7848187]
- Updated dependencies [7848187]
- Updated dependencies [7848187]
  - @narduk-enterprises/narduk-core@1.20.0
