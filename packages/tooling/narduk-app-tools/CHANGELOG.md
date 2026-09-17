# @narduk-enterprises/narduk-app-tools

## 0.5.0

### Minor Changes

- 1af628c: Add `narduk-app foundation:check:toolchain` — foundation item 11,
  `toolchain-single-source` (Logan, askme 2026-09-17: _"Single-source toolchain
  versions (Recommended)"_ — one declared Node/pnpm source per app; every other
  place either reads it or is checked against it, so a bump is one edit).

  The command prints every place the app writes a Node or pnpm version down,
  with its file, line, value and verdict, and fails on any disagreement. Like
  items 8, 9 and 10 it is a separate command and JSON artefact
  (`tool: '@narduk-enterprises/narduk-app-tools/toolchain-single-source'`),
  because `foundation:check --json` is the exact 7-item contract company-hq
  `check-web-foundation.py` validates. Same exit codes, no warn tier, no
  credential required.

  **The sources, chosen on what tools actually read.** Node is `.node-version`:
  the widest native readership (`actions/setup-node` via `node-version-file`,
  fnm, mise, nodenv) and, decisively, the only Node declaration a workflow can
  _point at_ rather than restate — which is what removes the CI literal
  entirely. pnpm is the root manifest's `packageManager`: corepack, pnpm itself
  and `pnpm/action-setup` all read it natively, and the shared
  `nuxt-cloudflare.yml`'s own pnpm step already relies on exactly that.

  Everything else is a mirror, because Volta and npm can read a version from
  nowhere but a manifest and a Markdown table reads nothing: `engines.*`,
  `volta.*`, an optional `.nvmrc` or `.tool-versions`, and the
  `docs/workers-builds.md` rows that record the Cloudflare dashboard build
  environment. A mirror either derives from the source — a workflow's
  `node-version-file`, a `pnpm/action-setup` with no `version:` — or is compared
  against it.

  **`--fix` closes the loop.** It rewrites a drifted mirror's literal on the
  exact line the scan located, leaving every other byte alone (no
  `JSON.stringify` round trip, so an app's own manifest is not reformatted or
  reordered), and a Markdown row keeps its column width where the padding can
  absorb the change. Bumping Node becomes: edit `.node-version`, run `--fix`.

  It deliberately does not rewrite a workflow. Turning `node-version:` into
  `node-version-file:`, or dropping a `pnpm/action-setup` `version:` input,
  changes the shape of a file the app owns and its contract with the shared
  workflow — a one-time migration, reported with the exact edit and left for a
  human. It also will not invent a missing `.node-version`: with no source there
  is nothing to derive from, and promoting a mirror would be a guess.

  A CI literal that currently _agrees_ with the source is still a finding: it is
  a second declaration, and the second declaration is the thing being removed.

- 9da4063: Add `narduk-app foundation:check:coverage` — foundation item 9,
  `shared-capability-coverage`.

  **What it reports.**

  _(a) Inventory._ Every `@narduk-enterprises/*` dependency the app pins, with
  its version, the manifest it came from and the dependency block it sat in —
  one row per `(package, manifest, block)` across the root manifest and the
  workspace manifests at the monorepo-candidate paths item 1 already reads.
  Beside it, the catalog of shared capabilities the estate publishes, each
  marked adopted or not. The catalog is **derived from narduk-libs' own
  `pnpm-workspace.yaml`**, not hand-typed:
  `scripts/generate-capability-catalog.mjs` writes
  `src/foundation/capability-catalog.ts`, private workspace packages are
  excluded because an app cannot depend on one, and `pnpm run scripts:test`
  fails in required CI when the committed file falls out of step with the
  workspace. The whole inventory is a first-class `inventory` block in the
  `--json` artefact so the estate roster consumes it as data rather than parsing
  sub-check prose.

  _(b) Reimplementation detection._ Five detectors for app-local code doing a
  shared package's job — an app-local `createLogger`/`logger.ts` with a console
  transport (`@narduk-enterprises/narduk-logging`), a local `useSeo` /
  `defaultSocialMeta` twin (`narduk-seo`), a direct `posthog-js` import
  (`narduk-analytics`), a `server/api/**/health*` route that never references
  `registerHealthCheck` (`narduk-core`), and a Nitro plugin that hooks
  `error`/`afterResponse` or attaches a response `finish` listener and logs from
  it (narduk-logging adoption guide step 5). Each detector asks one further
  question: is the owning shared package a dependency? If yes the match is
  **confirmed** and reported as a **FAIL** naming the exact file path and the
  owning package; if no it is **heuristic** and reported as a **WARN**, which
  carries the existing `unknown` status (exit 2) plus `confidence: 'heuristic'`
  in the artefact. The four verdicts read as _proven_ (`pass`), _gap_ (`fail`),
  _unknown_ and _not-applicable_; there is no fifth status and no new
  vocabulary.

  **Shape.** Its own command and its own artefact
  (`tool: '@narduk-enterprises/narduk-app-tools/capability-coverage'`), exactly
  as item 8 `shared-ui-pinned` is: `foundation-check.json` stays the precise
  7-item contract company-hq `check-web-foundation.py` `validate_artefact()`
  consumes, and an `id` outside `1..7` would be a rollup-red F3 ARTEFACT finding
  on every app. No registry credential is required — every verdict comes from
  the app's own manifests and source.

  **Zero false positives** is the acceptance bar, proven against
  `narduk-enterprises/buoys` at `cc72c3d` (PASS, exit 0, 13 estate pins, 112
  files scanned, 0 detections) and a freshly generated `create-narduk-app@0.6.3`
  scaffold (PASS, exit 0, 11 pins, 7 files scanned, 0 detections). Both shapes
  are committed as fixtures.

  Also: `AppRepo.walk()` now skips `.output`, `.nuxt`, `.nitro`, `.wrangler`,
  `.turbo` and `coverage` alongside `node_modules`, `.git` and `dist`. A built
  Nitro bundle inlines every dependency, so a conformant app's
  `.output/server/chunks` contains `createLogger`, `posthog-js` and a health
  route — a content scan that reached it would report the whole estate as
  forking itself.

- 894cd17: Add
  `narduk-app foundation:check:security-headers --base-url <url> [--path <p>]...`,
  a live probe of a deployment's security response headers for narduk-core's
  `security.headers` preset.

  It reports, per probed route, whether a Content-Security-Policy is enforcing,
  report-only, or absent; whether the policy actually in force uses a nonce
  rather than `'unsafe-inline'` / `'unsafe-eval'`; and whether
  `Strict-Transport-Security`, framing restriction, `Referrer-Policy`,
  `Permissions-Policy` and `X-Content-Type-Options` are present — each proven, a
  gap, or unknown.

  Unlike items 1-8 this one has no filesystem verdict. A response header is
  produced by a running server and a checkout can describe a policy it does not
  serve, so no `--base-url` means `unknown` (exit 2), never `pass`. It is a
  separate command and one-item artefact
  (`tool: '@narduk-enterprises/narduk-app-tools/security-headers'`) for the same
  reason `foundation:check:shared-ui-pinned` and `foundation:check:coverage`
  are: `foundation-check.json` is the ratified 7-item contract company-hq
  `check-web-foundation.py` validates, and an `id` outside `1..7` is a
  rollup-red F3 ARTEFACT finding. No registry credential is required.

### Patch Changes

- b59907e: The social-preview check no longer requires
  `twitter:card=summary_large_image` or `twitter:image`, because the estate
  stopped emitting every `twitter:*` meta name (narduk-libs#349). The Open Graph
  contract is unchanged and still strict: exactly one non-empty `og:title`,
  `og:description`, `og:type`, `og:image:alt` and `og:url`, a canonical `og:url`
  on the declared origin, declared `og:image:width` / `og:image:height` of
  1200x630, and an `og:image` from a declared origin. Both the Twitterbot and
  Applebot profiles still probe every sampled route.
- 39c28ff: Raise the `sharp` runtime dependency from `^0.34.5` to `^0.35.4` in
  `narduk-app-tools` and `narduk-testkit`, and release the generator so its
  hard-coded pins for both packages move with them.

  `sharp` is a published runtime `dependencies` entry in both packages, so the
  fix only reaches consumers through a release. `0.35.4` closes two
  high-severity inherited advisories: GHSA-f88m-g3jw-g9cj (libvips
  CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591, fixed in
  0.35.0) and GHSA-rgj7-g3m4-5g8c (libheif GHSA-g89c-p67h-r497 and
  GHSA-2jg2-4ch7-h545, fixed in 0.35.4).

  `sharp@0.35` raises its Node floor to `>=20.9.0` and drops the `install`
  script, so a platform without a prebuilt `@img/sharp-*` binary must now fall
  back to WebAssembly or build libvips by hand. Neither package declares
  `engines`, and the estate runs Node 24, so no supported consumer loses a
  platform. The call sites — `metadata()`, `stats()`, `resize()`, `toFormat()`,
  `ensureAlpha().raw()`, `failOn` and `limitInputPixels` — are unchanged in
  0.35.x; the removed `failOnError` and `paletteBitDepth` APIs were never used.

## 0.4.2

### Patch Changes

- fc816c4: `foundation:check` sub-check 2.3 (narduk-core N-1 window) now raises
  the default registry-read timeout from 4000 ms to 20000 ms, overridable via
  `NARDUK_FOUNDATION_REGISTRY_TIMEOUT_MS`, and retries up to twice with backoff
  on timeout/network-error/5xx responses only -- never on 401/403/404. This
  fixes false-`unknown` (blocking) results on the on-prem runner's slow GitHub
  path (narduk-libs#341). Fail-closed semantics are unchanged: a genuinely
  unreachable registry still reports `unknown` after exhausting the retry
  budget.

  `@narduk-enterprises/create-narduk-app` gets a patch release alongside this to
  refresh its `narduk-app-tools` pin in `src/manifest.ts`
  (`scripts/check-generator-release-plan.mjs` requires a generator release
  whenever a package it pins changes version); no generator behavior changes.

## 0.4.1

### Patch Changes

- 76aba10: Retire branding-based status-app classification. Keep subcheck 3.4 as
  explicitly not-applicable and continue checking actual web capabilities.
  Legacy status-runtime consumers remain supported; new apps do not need that
  package.

## 0.4.0

### Minor Changes

- 8abb3c8: Retire the implicit Doppler execution in `narduk-app dev`
  (narduk-libs#321).

  **Breaking for existing callers of `narduk-app dev`.** The command used to run
  every child through `doppler run`, with `--project` / `--config` selecting a
  Doppler project and config — an implicit dependency on the retired app-secret
  store. It now runs one child process through an explicit credential route:

  - no `--credentials` (the default) runs the child directly, so an app whose
    local development needs no secrets has no secret-store dependency at all;
  - `--credentials nvault` requires a complete `--project` / `--environment` /
    `--config` selector and runs
    `nvault run -p <project> -e <environment> -c <config> -- <command>`, the
    registered local credential route, whose values stay process-local
    (company-hq `docs/SECRETS-MATRIX.md`, plane 4);
  - `--dry-run` prints the resolved command without running it.

  The retired invocation
  `narduk-app dev --project <app> --config dev -- <command>` now fails with a
  message naming both replacements, rather than silently starting a dev server
  without the environment it used to receive. `--credentials doppler` fails the
  same way. Doppler `ne/*` root provisioners remain a separately approved
  provider-root exception and are not an application development credential
  source.

  The exported `buildDopplerRunArgs` is replaced by `buildNvaultRunArgs`,
  `buildDevInvocation` and `formatDevInvocation`.

  Generated apps start Nuxt directly: the web `dev` script is now
  `nuxt dev --host 127.0.0.1`, and the generated README documents the nvault
  route an app adopts when it later needs credentials locally.
  `narduk-app deploy-local` is a different command and still reads Doppler
  `narduk/tokens`; it is unchanged.

## 0.3.1

### Patch Changes

- 994551d: Read only the parsed HTML head during social-preview crawler checks,
  retaining the head byte limit and all metadata checks without downloading
  unrelated SSR payloads.

## 0.3.0

### Minor Changes

- 05a1aa9: Add `narduk-app foundation:check:shared-ui-pinned`
  (components-library-plan.md §2 item 6, narduk-libs#253): item 8
  `shared-ui-pinned` requires that wherever a UI app depends on
  `@narduk-enterprises/narduk-shell`, `narduk-ui`, or `narduk-charts`, the pin
  is an exact version — no range, no `workspace:` specifier. A shared-UI package
  the app does not depend on is `not-applicable`, and an API-only app (no
  `nuxt.config.*` and no pages/components directory at a known monorepo path) is
  `not-applicable` in full. Ships as its own command and JSON artefact, not as
  an eighth item inside `foundation:check`'s seven-item artefact (company-hq's
  `check-web-foundation.py` rejects item ids outside `1..7` as F3 ARTEFACT).
- 09b35f7: `foundation:check:shared-ui-pinned` (item 8) stops conflating
  "published" with "required", and stops needing a registry credential
  (narduk-libs#282 review).

  - **Presence is no longer derived from publication.** The item now enforces
    one rule from the app's own manifests: _if the app depends on a shared-UI
    package, that pin must be exact_. It no longer fails a UI app for not
    depending on `narduk-ui` or `narduk-charts` — those are capability-specific
    (a charting library is not mandatory on an app that draws no charts, and
    `narduk-ui` is the `Ns*` status instruments "for the status apps"). An
    unused package is `not-applicable`. The new exported `PRESENCE_REQUIRED` is
    the one place an estate-wide requirement would be recorded; it is empty,
    because no dated decision names a shared-UI package as required of _every_
    UI app, and a test pins it empty so an addition cannot land silently.
  - **No registry credential is needed, and exit 2 is no longer reachable for
    want of one.** Exact-pin discipline is a manifest fact. `RegistryReality` is
    still consulted, but only to annotate an already-decided sub-check with the
    latest published version; an unreadable registry drops the annotation and
    changes no status. `UNKNOWN` now means only "no `package.json` at a known
    monorepo path". This is what lets the command run in a generated app's CI,
    whose install step deliberately keeps the GitHub Packages token out of the
    ambient job environment.
  - **`FilesystemRegistryReality.publicationOf` fails toward `unknown` on an
    ambiguous 404.** GitHub Packages answers "no such package" and "your token
    cannot see this package" identically, so a mis-scoped token used to report
    every estate package as `unpublished` — a silent pass. A 404 is now
    corroborated with one memoized probe against `SCOPE_PROBE_PACKAGE`
    (`@narduk-enterprises/narduk-core`): only a token proven able to read the
    scope turns a 404 into `unpublished`; otherwise the answer is `unreadable`.

- fb0c50c: Add app-owned social preview generation and validation: default
  artwork, explicit route coverage, initial HTML checks, crawler image
  downloads, and distinct dynamic route images. The SEO module gains an opt-in
  global static fallback and canonical OG URLs, with explicit previews for
  public noindex pages. New scaffolds include artwork sources, metadata, route
  inventory, build gates, and crawler acceptance. Existing apps opt in through
  the migration guide; no fleet synchronization occurs.

## 0.2.1

### Patch Changes

- 3c0a608: `foundation:check` item 5.2 now also accepts `.github/dependabot.yml`
  as satisfying the "@narduk-enterprises scope addressed" requirement, alongside
  the existing `renovate.json` / `.github/renovate.json` check (narduk-libs#233,
  company-hq D-TOOLCHAIN-1). A `groups.*.patterns` entry matching the scope
  (grouping) or an `ignore[].dependency-name` entry matching it (delegation, the
  Dependabot-native equivalent of Renovate's `packageRules[].enabled: false`)
  both pass, mirroring borderwaitstat-us PR #19's `ignore` block. Dependabot is
  the documented preferred form going forward; `renovate.json` still passes on
  its own since not every repo has migrated yet. Consumers do not need to keep a
  `renovate.json` around once they adopt `.github/dependabot.yml` with either
  shape — bump to this version to delete it without failing item 5.2.

## 0.2.0

### Minor Changes

- 927f7e3: narduk-app-tools: add the `foundation:check` command (D-WEBFOUND-2
  Q5(a), Q9(a)) — the app-owned half of the web-foundation contract, built
  against the spec company-hq PR #631 merged at `docs/WEB-FOUNDATION-CHECK.md`
  and `strategy/web-foundation-libs-plan.md` §4.

  `foundation:check` evaluates all seven §4 items from inside an app's own
  checkout and CI, and writes a `foundation-check.json` artefact that
  `company-hq/scripts/check-web-foundation.py`'s weekly rollup accepts as-is
  (exact schema, `CONTRACT_ITEMS` naming, and the item-7 `not-applicable`
  invariant all mirror the rollup's own `validate_artefact()`). Exit code 0 =
  PASS, 1 = FAIL, 2 = UNKNOWN (CI must treat unknown as a failing gate too — no
  warning tier, per D-WEBFOUND-2 Q9(a)).

  Unlike the rollup, this command owns four sub-checks the rollup can only
  report `unknown` for, because they need the real checkout or a live registry
  read that a cross-repo weekly scan does not have:

  - 1.1 — resolves the actual Nitro preset from `.output/nitro.json` or
    `nuxt.config.*` when `Config/cloudflare-app.json` doesn't declare one.
  - 2.3 — the narduk-core N-1 support window (D-PKG-2), by resolving the
    installed major against the live published major.
  - item 3 in full — the five capability-package checks (auth, seo/analytics,
    uploads, status-runtime, no unauthorised chart/map dependency), gated on the
    real `access.exposureClass` and binding config.
  - 4.2 — a whitespace-normalised content-hash scan against a `narduk-libs#76`
    Wave-1 fork fingerprint list, so a locally-vendored copy of package-owned
    behaviour is caught by content, not by path.
  - P7 — eslint-config's "v2" requirement is checked against the _resolved_
    installed major, not the manifest's pin string.

  Ships as `src/foundation/**` (schema, roll-up, per-item evaluators, an
  injectable `RegistryReality` for the live npm/GitHub-Packages read) and
  `src/commands/foundation-check.ts` (`--checkout <dir>`, `--json [path]`),
  wired into `narduk-app foundation:check` in `src/cli.ts`. Full test suite
  under `tests/foundation/**` proves every sub-check in both directions with
  seeded-lie fixtures (a fixture that passes is mutated one fact at a time until
  it fails, and back).

  The shared CI callable step in the `workflows` repo that runs this command and
  uploads its artefact is out of scope for this change; see the follow-up noted
  on company-hq#628.

  Part of company-hq#628.

### Patch Changes

- d6e098e: Fix `narduk-app db migrate` for npm-based consumers. It previously
  shelled every wrangler invocation through the active package manager's `exec`
  subcommand (`spawnPnpmSync(['exec', 'wrangler', ...])`), which either invokes
  `npm exec` (silently dropping the `--command` flag's value under npm's
  argument parsing) or crashes outright when `pnpm exec` refuses to run inside
  an npm-configured consumer. Wrangler is now resolved and spawned directly (the
  consumer's own `node_modules/.bin/wrangler`, falling back to Node module
  resolution from the consumer root), independent of which package manager is
  active (narduk-libs#122).

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

## 0.1.2

### Patch Changes

- a783f18: Ignore stale package-manager entrypoints and fall back to the
  executable installed in `PNPM_HOME`, keeping repeated migration runs
  independent of `PATH`.

  Update generated-app package pins for the corrected app-tools release.

## 0.1.1

### Patch Changes

- 435cc56: Run Wrangler through the package manager entrypoint that launched
  `narduk-app`, avoiding PATH-dependent migration failures on repeated CI
  invocations.

  Update generated-app package pins for the corrected app-tools release.
