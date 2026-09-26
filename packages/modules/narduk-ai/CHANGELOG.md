# @narduk-enterprises/narduk-ai

## 0.4.2

### Patch Changes

- 672f77a: narduk-auth, narduk-seo, narduk-analytics and narduk-ai now declare
  `@nuxt/ui` as a peer at exactly `4.11.1` (#1033). Each package renders Nuxt UI
  components and none declared it. This is the version narduk-core already
  depends on and narduk-shell already requires as a peer, so an app on
  narduk-core already installs it. An app on another `@nuxt/ui` version now gets
  pnpm's peer warning.
- Updated dependencies [97b3cec]
- Updated dependencies [48048b9]
- Updated dependencies [01090c4]
- Updated dependencies [70c0170]
  - @narduk-enterprises/narduk-core@2.18.0

## 0.4.1

### Patch Changes

- Updated dependencies [e4c5dcb]
- Updated dependencies [6e7286c]
- Updated dependencies [9434163]
  - @narduk-enterprises/narduk-core@2.17.0

## 0.4.0

### Minor Changes

- cbfcc73: Add `server/utils/chatCompletions`: `chatCompletion` /
  `chatCompletionJson`, a provider-neutral OpenAI-compatible chat client with
  `baseUrl`, `maxTokens`, JSON mode, a per-attempt timeout, a 5xx/network retry,
  usage in the result and sanitized H3 errors that never carry the raw provider
  body (#985). `grokChat` is unchanged.

### Patch Changes

- Updated dependencies [abb9b15]
- Updated dependencies [39046cb]
- Updated dependencies [4276bf3]
- Updated dependencies [b3c821f]
  - @narduk-enterprises/narduk-core@2.16.0

## 0.3.25

### Patch Changes

- Updated dependencies [47f7131]
- Updated dependencies [f17ce87]
- Updated dependencies [02b999f]
- Updated dependencies [6a12081]
- Updated dependencies [5ed9665]
- Updated dependencies [8b0e555]
- Updated dependencies [5de0ec4]
- Updated dependencies [ffae997]
- Updated dependencies [f63937e]
- Updated dependencies [0ab6fb1]
  - @narduk-enterprises/narduk-core@2.15.0
  - @narduk-enterprises/narduk-platform@2.2.0

## 0.3.24

### Patch Changes

- Updated dependencies [61462de]
- Updated dependencies [786568d]
- Updated dependencies [776c0a1]
  - @narduk-enterprises/narduk-core@2.14.1

## 0.3.23

### Patch Changes

- Updated dependencies [70168be]
- Updated dependencies [1dc62db]
- Updated dependencies [1dc62db]
- Updated dependencies [73c6246]
- Updated dependencies [ab81821]
- Updated dependencies [1dc62db]
- Updated dependencies [3052028]
- Updated dependencies [9cb7dbf]
- Updated dependencies [d8f4366]
- Updated dependencies [7ae3a16]
  - @narduk-enterprises/narduk-platform@2.1.2
  - @narduk-enterprises/narduk-core@2.14.0

## 0.3.22

### Patch Changes

- Updated dependencies [dfa8d39]
  - @narduk-enterprises/narduk-core@2.13.1

## 0.3.21

### Patch Changes

- Updated dependencies [e8a373e]
- Updated dependencies [12f3294]
- Updated dependencies [e87803e]
  - @narduk-enterprises/narduk-core@2.13.0

## 0.3.20

### Patch Changes

- Updated dependencies [551e39a]
  - @narduk-enterprises/narduk-core@2.12.0

## 0.3.19

### Patch Changes

- Updated dependencies [5747011]
- Updated dependencies [02b6c1a]
- Updated dependencies [b0dca25]
- Updated dependencies [45ea540]
- Updated dependencies [f395bd6]
  - @narduk-enterprises/narduk-core@2.11.0

## 0.3.18

### Patch Changes

- Updated dependencies [0da668a]
- Updated dependencies [5ac629e]
- Updated dependencies [1759259]
- Updated dependencies [5ac629e]
  - @narduk-enterprises/narduk-core@2.10.1
  - @narduk-enterprises/narduk-platform@2.1.1

## 0.3.17

### Patch Changes

- 056105e: Bump `@nuxt/ui` from `4.8.1` to `4.11.1` everywhere the layer pins
  it: the `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest (following the same coordinated-pin pattern as 8f693b1).

  A consumer app already on `@nuxt/ui@4.11.1` (buoys#287) failed
  `nuxt typecheck` against narduk-core's `AppTabs.vue`:

  ```
  error TS2345: Argument of type '{ ... items: TabsItem[] | undefined; ... }' is
  not assignable to parameter of type '... items?: TabsItem[] | undefined; ...'.
    Type 'import(".../@nuxt+ui@4.8.1/.../Tabs.d.vue").TabsItem[] | undefined' is
    not assignable to type 'import(".../@nuxt+ui@4.11.1/.../Tabs.d.vue").TabsItem[]
    | undefined'.
  ```

  Two different `@nuxt/ui` installs (narduk-core's pinned `4.8.1` and the app's
  own `4.11.1`) produced structurally distinct `TabsItem`/`AvatarProps` types
  that TypeScript will not unify, even though both come from the same package
  name. Matching narduk-core's declared version to the app's removes the
  duplicate-copy mismatch.

  `nuxt typecheck` passes clean in narduk-core against `4.11.1` with no source
  changes; no other breaking change between `4.8.1` and `4.11.1` touched
  anything in this workspace.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.11.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy -- the duplicate-copy failure this release removes.

  Refs narduk-enterprises/buoys#287.

- Updated dependencies [056105e]
  - @narduk-enterprises/narduk-core@2.10.0

## 0.3.16

### Patch Changes

- Updated dependencies [671fbf3]
  - @narduk-enterprises/narduk-core@2.9.0

## 0.3.15

### Patch Changes

- Updated dependencies [df7568d]
  - @narduk-enterprises/narduk-core@2.8.1

## 0.3.14

### Patch Changes

- Updated dependencies [cecc72a]
- Updated dependencies [62b7b79]
- Updated dependencies [62b7b79]
- Updated dependencies [c574403]
- Updated dependencies [2671ccd]
- Updated dependencies [b672613]
  - @narduk-enterprises/narduk-core@2.8.0

## 0.3.13

### Patch Changes

- Updated dependencies [693f7d3]
  - @narduk-enterprises/narduk-core@2.7.0

## 0.3.12

### Patch Changes

- Updated dependencies [fa2f123]
  - @narduk-enterprises/narduk-core@2.6.4

## 0.3.11

### Patch Changes

- Updated dependencies [ecc731b]
  - @narduk-enterprises/narduk-core@2.6.3

## 0.3.10

### Patch Changes

- Updated dependencies [81051b0]
  - @narduk-enterprises/narduk-core@2.6.2

## 0.3.9

### Patch Changes

- Updated dependencies [448e86f]
- Updated dependencies [7142305]
  - @narduk-enterprises/narduk-core@2.6.1

## 0.3.8

### Patch Changes

- Updated dependencies [4599aa7]
- Updated dependencies [4ba5d02]
  - @narduk-enterprises/narduk-core@2.6.0

## 0.3.7

### Patch Changes

- Updated dependencies [8d35cb8]
- Updated dependencies [8d35cb8]
- Updated dependencies [8d35cb8]
- Updated dependencies [92835a1]
  - @narduk-enterprises/narduk-core@2.5.0

## 0.3.6

### Patch Changes

- Updated dependencies [bb37590]
- Updated dependencies [bb37590]
  - @narduk-enterprises/narduk-core@2.4.0

## 0.3.5

### Patch Changes

- Updated dependencies [8da7e33]
- Updated dependencies [05b3ef9]
  - @narduk-enterprises/narduk-core@2.3.0

## 0.3.4

### Patch Changes

- Updated dependencies [fe58c5f]
  - @narduk-enterprises/narduk-core@2.2.4

## 0.3.3

### Patch Changes

- Updated dependencies [7ae9278]
  - @narduk-enterprises/narduk-core@2.2.3

## 0.3.2

### Patch Changes

- Updated dependencies [766ce96]
  - @narduk-enterprises/narduk-core@2.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [fa41027]
- Updated dependencies [fa41027]
  - @narduk-enterprises/narduk-core@2.2.1

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
