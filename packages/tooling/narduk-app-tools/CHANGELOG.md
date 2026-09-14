# @narduk-enterprises/narduk-app-tools

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
