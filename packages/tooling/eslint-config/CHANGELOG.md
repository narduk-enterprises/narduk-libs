# @narduk-enterprises/eslint-config

## 2.0.2

### Patch Changes

- b69913a: Bump the package's own toolchain to the estate baseline (company-hq
  D-TOOLCHAIN-1, 2026-09-10): `typescript` `~6.0.3` (was `^5.9.3`),
  `@types/node` `^24` (was `^22.19.19`), and every `@typescript-eslint/*` plus
  `typescript-eslint` dependency to `^8.70.0` (was `^8.65.0`). `engines.node`
  moves to `>=24.0.0`.

  No public API or config-output change. `tsconfig.json` gains
  `"ignoreDeprecations": "6.0"` because `tsup@8.5.1` injects a deprecated
  `baseUrl` into its own DTS build program under TypeScript 6 regardless of this
  package's own tsconfig (TS5101); `"types": ["node"]` was already present, so
  the TS6 Node-builtins issue (TS2591) that the same migration hit on the
  superseded v1 `narduk-eslint-config` line did not recur here.

  Consumers pinning `engines.node: >=24.0.0` on install must be on Node 24;
  anyone still on Node 22 who picks up this version will hit
  `ERR_PNPM_UNSUPPORTED_ENGINE` (a warning under this repo's default
  `engine-strict: false`, but a hard failure under a consumer's own
  strict-engine setting).

  `create-narduk-app` is a generator-owned package whose `src/manifest.ts`
  hardcodes the exact `@narduk-enterprises/eslint-config` version newly
  scaffolded apps pin (`scripts/sync-generator-package-versions.mjs` keeps it in
  sync with each package's own `package.json` version at release time).
  Releasing eslint-config `2.0.2` without a matching create-narduk-app release
  would leave that pin stale, so this changeset bumps create-narduk-app too -- a
  metadata/version sync only. No source, template, or toolchain change to
  create-narduk-app itself; it still targets TypeScript 5.9/Node 22 and is
  unrelated Wave 1 work.

## 2.0.1

### Patch Changes

- 048670e: Gate the Tailwind theme override on the `design-system` capability
  pack, not on the entry file alone.

  `createAppLintConfig` attached the `better-tailwindcss/*` theme rules whenever
  the Tailwind entry file existed on disk, but only the `design-system` pack
  registers the `better-tailwindcss` plugin. ESLint does not degrade when an
  enabled rule's plugin is missing — it throws
  `Could not find plugin "better-tailwindcss" in configuration` while
  normalising the config and lints nothing, so any app that selected no
  `design-system` while keeping its stylesheet at the conventional
  `app/assets/css/main.css` crashed out of the box. Found by the first consumer
  migration.

  The override now requires the pack (`'designSystem'` resolves too) **and** the
  entry file. No pack means no override, whatever is on disk. Passing
  `tailwindEntryPoint` without the pack is the one contradiction the app has to
  resolve, and now throws a named configuration error at compose time instead of
  dying inside ESLint's plugin resolution.

## 2.0.0

### Major Changes

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
