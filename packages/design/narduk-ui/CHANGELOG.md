# @narduk-enterprises/narduk-ui

## 0.1.4

### Patch Changes

- 31a43a7: Stop `NsFreshnessChip` from reading the ambient clock during SSR. Without `now`,
  the preferred `observedAt` path renders a stable placeholder until mount.

## 0.1.3

### Patch Changes

- 98a199b: Add an NE Base design card (`design-cards/<Name>.card.vue`) for every registered
  status instrument (`NsFreshnessChip`, `NsLevelWell`, `NsRangeBar`,
  `NsReadoutTile`), completing the suite bar's last requirement alongside the
  existing README sections and mount/SSR tests.
  `scripts/check-component-surface.mjs` now checks this package (components
  backlog item 22, narduk-libs#269).
- 74aecaf: Add README sections (props, slots, events, one example) plus mount and no-DOM
  SSR tests for every registered status instrument: `NsFreshnessChip`,
  `NsLevelWell`, `NsRangeBar` and `NsReadoutTile`. Existing core
  measurement/signal guardrail tests are unchanged.

## 0.1.2

### Patch Changes

- 6197f80: Provide neutral accent defaults for consumers without a product `data-app`
  scope, keeping range and level-well fills visible. Product accent overrides
  retain precedence.

## 0.1.1

### Patch Changes

- 95ec690: `@narduk-enterprises/eslint-config` v2: the estate lint config moves into
  narduk-libs (per HB-10 / D-DEMOTE-1 and narduk-libs#50), rebuilt for ESLint 10
  on a replace-by-default basis — maintained third-party plugins wherever they
  cover the intent, 45 bespoke rules surviving out of 103 (every one with tests
  and no `testMode` bypasses), the proven-inverted hydration rules and dead Nitro
  security gates rebuilt against the executed deep-review proofs, legacy presets
  and the frozen nuxt-ui spec tier removed, and every code-corrupting autofixer
  gone. Consumer API (`createAppLintConfig`, `composeSharedConfigs`, the 14
  capability packs) is signature-compatible; adopting v2 requires ESLint `^10`
  (peer). License corrected to UNLICENSED (D-PKG-5).

  **Three consumer-visible tightenings** land with the adversarial-hardening pass
  (full account in `DESIGN.md`):

  1. **Pack globs are nesting-safe.** `server/**`, `workers/**` and the auth
     pack's globs now match at any depth. A repository linted from an outer `cwd`
     — any monorepo, any app one level down, and every layer package's
     `runtime/server/**` — previously received **no** server or Cloudflare rules
     at all. Expect first-time findings in newly-covered trees. The two core rules
     the packs carry are gated out of `tests/**` and friends so the widening does
     not sweep in test code.
  2. **A route named like a test is a route.** `server/api/x.post.test.ts` is
     deployed by Nitro as `POST /api/x.post.test`, and the `.test.` infix no
     longer exempts it from the security tier. Inside a route tree only a real
     test or fixture _directory_ exempts a file. Move colocated route suites under
     `tests/` or `__tests__/`.
  3. **`no-restricted-imports` is order-independent.** All three contributing
     packs now assign one shared option, so a trailing `cloudflare` entry can no
     longer erase the relative-import and layer-source patterns — which it did for
     every consumer using `nardukTemplateStrictCapabilityPacks`. Those patterns
     start applying again. A portable Nuxt layer (no `#server/*` alias for its own
     sources) should assign the new `PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE`
     export to its server glob rather than switching the rule off.

  Also fixed in the same pass: five ways to walk past a security rule by renaming
  a binding (an aliased `defineEventHandler`, a runtime-derived HTTP method,
  `.raw` lifted off drizzle's `sql`, a destructured `db.query` receiver, and
  `limit: undefined`), and `no-legacy-overlay-model`'s blindness to camelCase
  `modelValue` bindings. Every one ships with the fixture that proved it as a
  regression test.

  Sibling packages: the shared config is now consumed via the workspace
  (`workspace:*`) and their `eslint` devDependency moves to `^10.8.0`. Adopting v2
  also swept their stale `eslint-disable` comments onto the replacement rule ids
  and cleared the findings the fixed path gates newly surface. Three
  behaviour-neutral source edits came with that sweep: `narduk-core` adds
  `import.meta.client` early returns to three handlers that were already
  client-only (clipboard copy, share-link copy, avatar canvas resize);
  `narduk-auth`'s `runtime-public` endpoint drops a `process.env` merge layer that
  `readWorkerRuntimeEnv` already supplied and that the merge order discarded; and
  `narduk-app-tools` swaps one `split().join()` for `replaceAll()`. The five layer
  packages (`narduk-core`, `-auth`, `-seo`, `-ai`, `-uploads`) assign the
  portable-layer import rule in their own configs, and `narduk-core` and
  `-uploads` carry scoped, commented exceptions for the pre-existing conditions
  their newly-linted `runtime/server/**` trees surfaced.

## 0.1.0

### Minor Changes

- 21551ed: Publish the status shared packages extracted from status-apps into narduk-libs.

  `@narduk-enterprises/narduk-ui` ships the Narduk Status Design System token
  layer, framework-free measurement core, and instruments components.
  `@narduk-enterprises/status-runtime` ships the shared build-time helpers
  (`resolveSourceRevision`, design-system font links and theme color).

  Behavior-preserving extraction: source files match
  `status-apps@cfa14c181b815a84fd6cfb277233d1ade63b5959` byte-for-byte. No runtime
  dependencies. Consumers pin exact published versions from GitHub Packages.
