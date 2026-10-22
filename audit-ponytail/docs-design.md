# Docs and design audit (ponytail 5)

What this repo does: It publishes the shared `@narduk-enterprises/*` libraries and the one-shot app generator that Nuxt apps on Cloudflare Workers install. It is not a fleet template, and the generator must not keep managing an app after it writes the repo once. Agents and operators read these docs before they change a package, cut a release, or move an app off the old template.

Load assumed: many production apps install exact versions from GitHub Packages. A release runs from `main`. One wrong sentence becomes a wrong pin, a skipped security fix, or a second production move. I assumed a reader follows the doc as written and does not already know the tree.

Checked on `main` at `6fa6e1606cdb753cd400262fd80d33c2be87cad6`. Relative links in the in-scope markdown: 85 files, 76 local links, none missing. Package directories match the root README list.

Smaller notes left out: 5. They are listed under Not checked.

## Must fix

### 1. SECURITY.md:14-16 — latest version only, while N-1 still gets security fixes

What this is: The GitHub security policy says which versions get a fix.

Problem: `SECURITY.md` says only the latest published version of each package receives security fixes. `docs/package-support-window.md:10-13` and `docs/package-support-window.json` say the opposite, and CI checks that file. When package major N ships, major N-1 keeps security fixes until every consumer who was on N-1 has moved, or for 90 days, whichever is longer. `docs/package-releases.md:13-18` points at that window. Case: a CVE in `narduk-core` 2.x after 3.x is published. A maintainer who follows `SECURITY.md` ships no 2.x fix. The support-window rule says that fix is still owed.

Fix: Rewrite the Supported versions section so it states the N-1 window and links to `docs/package-support-window.md`.

If we skip it: A reporter and a maintainer follow different policies. An N-1 app stays on a known bug for the whole window.

### 2. docs/operations/template-decoupling/README.md:115-116 — migration table names the wrong MapKit and a local UI

What this is: The active operator runbook (`status: active`) for turning a template app into its own repo. `docs/package-releases.md:9-12` sends operators here after a publish.

Problem: The capability table says MapKit comes from `narduk-geo/narduk-mapkit`, not from this repo. This repo publishes `@narduk-enterprises/narduk-mapkit` at `3.0.0` and `@narduk-enterprises/narduk-mapkit-nuxt` at `2.0.6`. The generator pins both (`packages/tooling/create-narduk-app/src/manifest.ts:43-44`). The next row says to recreate operator UI locally with Nuxt UI. `@narduk-enterprises/narduk-shell` `0.29.2` is the shared UI, and the generator pins it (`manifest.ts:75`). Case: an operator migrating an app with a map installs the other MapKit repo and copies a local table and shell, then ships that fork.

Fix: Point MapKit at `@narduk-enterprises/narduk-mapkit` and `narduk-mapkit-nuxt` in this repo. Point operator UI at `narduk-shell`. Leave a one-line note that the July 2026 BSF pass predates both.

If we skip it: The next migration pins a package this repo does not release, and grows a second copy of the shell.

## Should fix

### 3. docs/ci.md:76-78 — packed consumer build says two workers; CI passes four

What this is: The CI doc's description of the packed-consumer build.

Problem: The paragraph says the coordinated build uses two Turbo workers, with each Node heap capped at 2048 MiB. The heap cap is right (`.github/workflows/ci.yml:345-348`). The worker count is not. The same workflow calls `scripts/prepare-packed-consumer.mjs --build-concurrency=4` (`ci.yml:435-437`). The script's own default is 2 (`scripts/prepare-packed-consumer.mjs:15-16`). `docs/package-releases.md:170-173` already says CI uses 4. Case: someone reproducing CI locally uses two workers, or "corrects" the workflow down to two to match this doc. The hosted job is four heaps of 2048 MiB on the 16 GiB runner.

Fix: Change "two Turbo workers" to four, and point at `--build-concurrency=4`.

If we skip it: A memory or timing change is tested against a different job than CI runs.

### 4. PLAN.md:71-74 — standing rules that the banner does not retire

What this is: The root plan. The banner says it is a finished wave, kept as written, and that only the old `packages/<name>` paths moved.

Problem: The banner does not cover the cross-lane rules under it. Those rules still say MapKit stays outside this repo under `@loganrenz/*`, and that new tooling has no postinstall hook. MapKit lives here (finding 2). The root `package.json:7` postinstall builds `@narduk-enterprises/eslint-config`. That `dist/` is not in git. Case: an agent treats the cross-lane section as current, refuses a mapkit change, and deletes the postinstall. The next `pnpm install` no longer builds the eslint config the root lint uses.

Fix: Add two sentences to the banner. MapKit is now `@narduk-enterprises/narduk-mapkit` in this repo. The root postinstall that builds eslint-config is required. Do not rewrite the old wave.

If we skip it: The next agent to open `PLAN.md` applies a rule the banner forgot to cancel.

### 5. docs/proposals/narduk-shell.md:3-24 — proposal still says the package is not built

What this is: The design note for the app shell. Issue #119 is closed.

Problem: Line 3 says "proposed, not built." Lines 17-24 say this repo has no package that supplies the shell. The package is `packages/design/narduk-shell`, published, and the generator pins `0.29.2`. The components plan still cites this file for the token set (`docs/plans/components-library-plan.md:90-91`). Case: an agent implements the proposal and starts a second shell package beside the one apps already import.

Fix: Replace the status with "shipped" and a link to `packages/design/narduk-shell/README.md`. Keep the token notes while the components plan still cites them.

If we skip it: The design note and the package disagree about whether the shell exists.

### 6. docs/plans/components-library-plan.md:33-114 — present-tense facts the tree has passed

What this is: The shell backlog. `narduk-shell`'s README still points here for ordering. The status line is "decided 2026-09-11", not "snapshot".

Problem: Three sentences are false now.

- Lines 33-36: narduk-core pins `@nuxt/ui` `4.6.0` exactly. `packages/modules/narduk-core/package.json:156` pins `4.11.1`. The peer is `>=4.7.1 <5` (`:183`). `narduk-shell` peers `@nuxt/ui` at `>=4.11.1 <5`.
- Lines 57-58: tabs are not wrapped; use `UTabs` directly. `NeTabs` is a registered tab strip (`packages/design/narduk-shell/src/registry.ts:122` and `src/runtime/components/NeTabs.vue`).
- Lines 109-114: nothing in this repo checks the README, tests, and design card. `scripts/check-component-surface.mjs` exists, and `quality:artifacts` runs `surface:check`.

Case: an agent adds a component with peer `@nuxt/ui` `4.6.0`, skips `NeTabs` and builds on `UTabs`, and adds a second surface check because the plan says none exists. Issues #248, #249, and #250 (items 1-3) are closed.

Fix: Mark items 1-3 shipped. Replace the three sentences with the current pin, `NeTabs`, and `surface:check`. Leave the decision log as history.

If we skip it: The next shell PR is aimed at a UI version and a gate that are not the ones in the tree.

### 7. docs/plans/libs-explorer-plan.md:3-5 — increment 1 is still "pending review"

What this is: The explorer plan. Its own note says the tracking table is the part that changes as work lands.

Problem: The status and the table row for increment 1 say "pending review" on PR #689, covering all 15 registered shell components. PR #689 merged on 2026-09-24. `packages/design/narduk-shell/src/registry.ts` now has 47 `Ne*` entries. The explorer README still says it is increment 1 of this plan. Case: an agent waits on a merged PR, or builds demos for 15 components. `inventory/check.mts` fails the build when any registered component has no example.

Fix: Mark increment 1 merged. Say the 15-component count was the registry on 2026-09-21, and coverage is whatever `registry.ts` lists now.

If we skip it: Explorer work starts from a review that already finished and a component count that is a third of the registry.

### 8. docs/plans/backlog-clearout-plan.md:56-58 and :116-154 — the queue is written as today's work

What this is: The campaign plan `AGENTS.md` still links. The milestone is open (19 open, 246 closed on 2026-10-22). The frozen "190 issues on 2026-09-20" baseline is fine. The later present-tense orders are not.

Problem:

- Lines 116-124 say these are still open today: #577, #544, #561, #631. All four are closed. The paragraph tells a lane to close #577 now and to canonicalize #544.
- Lines 143-154 tell the campaign to build scoped packed-consumer and local preflight, and say `narduk-lint` rewrites `lint-budget.json` during `quality` (#623). `scripts/preflight.mjs` and `prepare-packed-consumer.mjs --packages` exist. `AGENTS.md:127-129` says #623 is fixed and lint no longer writes that file.
- Line 283 says to run `scripts/verify-pr-gate.py`. That file is not in this repo. `docs/operations/claude-cloud-environment.md:60-62` correctly says the script lives in private agent-infrastructure.
- Lines 56-58 say the milestone description records the admission rule. The live milestone #1 description still admits only a P0, a security defect, or a release blocker. The amendment in this plan, and `AGENTS.md`, tell the orchestrator to admit whatever belongs at a wave boundary. Case: a P2 filed mid-campaign. The milestone text leaves it out. The plan says that text is the rule.

Case for the queue: a lane starts by re-closing #577 and by writing a second preflight, then runs a script path that does not exist.

Fix: Stamp the "still open today" list and Phase 2 as done or superseded, with the dates above. Point the gate at `verify-pr-gate.py` in agent-infrastructure, not `scripts/`. Update the milestone description so it matches the amendment. Do not rewrite the 2026-09-20 measurements.

If we skip it: The campaign doc keeps assigning work that has shipped, and two admission rules stay in force.

### 9. docs/operations/template-decoupling/README.md:352-356 — BSF cutover has not started, and it has finished

What this is: Phase 11 of the same active runbook as finding 2.

Problem: Lines 68-71 say BSF is `traffic-cutover-complete`, with profile proof and the 30-day retention still open. Line 491 lists the final traffic cutover as BSF PR #70. Phase 11 says the phase remains pending and, before it can start, the target build, zone, and registrar packet must be completed, then follow the account-cutover freeze and registrar move. Case: an operator reads "before it can start" and begins another freeze, D1 export, and registrar move on an app whose cutover PR is already merged.

Fix: Say BSF's traffic cutover is the PR #70 record. Phase 11 for BSF is the still-open product proof and retention, not a cutover that has not started.

If we skip it: The runbook can start a second account move on an app that already moved.

### 10. packages/design/narduk-charts/SECURITY.md:5-6 — CI does not run npm audit

What this is: The chart package's security note.

Problem: It says CI runs `npm audit --audit-level=high` on pushes and PRs. CI runs `pnpm audit --audit-level high` at the repo root (`.github/workflows/ci.yml:304`), and that command reads `pnpm.auditConfig.ignoreGhsas` in the root `package.json`. This package has no `package-lock.json`. Case: a developer runs `npm audit` in `packages/design/narduk-charts` and gets no lockfile audit, or a different advisory set than the gate, then treats a ignored or missing advisory as a CI failure.

Fix: Say the root command is `pnpm audit --audit-level high`, and point at the root ignore list.

If we skip it: Chart security checks do not match the check CI runs.

### 11. packages/design/narduk-charts/README.md:908-917 — local setup contradicts the top of the same file

What this is: The "Local development" section.

Problem: Lines 13-20 say the source lives in this repo, Histoire is `pnpm --filter @narduk-enterprises/narduk-charts run dev`, and the standalone `narduk-charts` repo is retired (last release 2.6.0 on 2026-09-23). Demos live on charts.nard.uk. Lines 910-917 say `npm install`, `npm run dev`, and that full-page demos are in a separate marketing-site repository. `CONTRIBUTING.md:13-18` matches the top of the README, not the bottom. Case: a contributor runs `npm install` inside the package. That ignores `pnpm-lock.yaml`. They then look for a marketing repo the same README says is retired.

Fix: Delete the npm block. Point at the `pnpm --filter` commands already in `CONTRIBUTING.md` and at charts.nard.uk for full-page demos.

If we skip it: Chart contributions install a different tree than CI, and hunt a repo that is gone.

### 12. packages/design/narduk-maps/docs/DESIGN.md:35-39 — design hexes are not the shipped harbor look

What this is: The design note the package README calls the spec (`packages/design/narduk-maps/README.md:9` and `:199-200`).

Problem: DESIGN.md's light tokens are water `#dfe8ee` and land `#f7f6f2`. The shipped harbor look is water `#d3e2eb` and land `#f6f5f1`, in both `packages/design/narduk-maps/src/tokens.ts:44-45` and `design/narduk-maps/gen/style.mjs:7` (`LOOKS.harbor`). `tokens.ts:4-6` says the TypeScript file is the home of the look. The README says the tokens are `LOOKS.harbor`. Case: a new map copies DESIGN.md and paints a different sea and land than `NardukGeoMap` defaults, so the poster and the live map do not match.

Fix: Put the shipped hexes in the DESIGN.md table, or label that table as the 2026-10-12 draft and point at `tokens.ts`.

If we skip it: Design review "fixes" the package colors back to a draft, or a new map is painted off-spec.

### 13. docs/plans/mapkit-consolidation-plan.md:3-8 — the replacement spec still says it is not built

What this is: The plan header. The body is marked as a 2026-09-14 appendix and is not an instruction. That part is fine.

Problem: The header says the current design is `packages/modules/narduk-mapkit/docs/api-2.1.md`. That file's lines 1-4 say it is a specification, not an implementation, for version 2.1.0. The published package is `@narduk-enterprises/narduk-mapkit` `3.0.0` with a `./nuxt` export (`packages/modules/narduk-mapkit/package.json:3` and `:84`). The body of `api-2.1.md` is outside this lane. The pointer is in this lane. Case: an agent follows the header, reads "not implementation", and starts a 2.1.0 build on a package that is already 3.0.0.

Fix: In the header, say `api-2.1.md` was the 2026-09-17 contract and that the published package is now 3.0.0. Leave the appendix as an appendix. Updating the spec file belongs to the mapkit lane.

If we skip it: The only "current design" link on this plan describes a version that is not the one we publish.

## Nice to have

### 14. packages/design/narduk-charts/SECURITY.md:20-22 — LICENSE file is not in the package

What this is: The license sentence in the chart security note.

Problem: It says the package is MIT and names `LICENSE` and `package.json`. `package.json:118` is `"license": "MIT"`. There is no `LICENSE` file under `packages/design/narduk-charts` or at the repo root. `files` is only `dist`, so the published tarball has the license field and no license text. Other packages in this repo do ship a `LICENSE` (for example `packages/modules/narduk-mapkit/LICENSE`). Case: a scanner or a consumer opens `LICENSE` in the chart package and gets nothing.

Fix: Either add a `LICENSE` file and include it in `files` (that edit is package metadata, outside this lane), or stop naming a file that is not there. Do not drop the MIT statement.

If we skip it: License review of the chart tarball fails on a missing file the doc promised.

## Verdict

Two docs that operators trust disagree with the tree on security support and on where MapKit and the shell come from. Fix those before the next migration or the next N-1 CVE. The other findings send an agent to rebuild a shell, a preflight, or a MapKit 2.1 that already shipped, or to paint maps from draft hexes.

## Not checked

GitHub's CodeQL, secret-scanning, and private-advisory switches. `SECURITY.md:20-22` says they are on. The repo API returned no `security_and_analysis` block, and the vulnerability-alert endpoints returned 403, so this audit does not say they are off. `dependabot.yml` is present. CI does run `pnpm audit`.

Not read in full: the 2026-09-11 per-app evidence dumps under `docs/plans/components-library-evidence-2026-09-11/` (dated snapshots; their parent links resolve), the body of `docs/plans/mapkit-consolidation-plan.md` below the superseded banner, the root `design/narduk-maps` HTML canvases and cutout JSON (except `gen/style.mjs`, which the maps README cites), and the long component sections of `narduk-shell`'s README past the status, install, pager, and `NeTabs` parts. Package READMEs outside `packages/design` were opened only to check a link or a heading this lane cites.

Spot-check only, and still true, so not filed as stale docs: `docs/logging-instrumentation.md` still matches `narduk-analytics` `insights.get.ts:77` (catch rethrows with no log) and both MapKit token routes (no `log` option). Those gaps are code work for the module lanes. The mapkit citation `mapkit-token.get.ts:131` is the comment above the call at line 134.

Out of scope, named so another lane can take them: `packages/design/narduk-charts/package.json` `bugs.url` still points at `narduk-enterprises/narduk-charts`, which this package's README says is retired. The label `area:music` still describes `packages/modules/narduk-music`, which `docs/architecture/narduk-logging.md` says moved out. The "not implementation" body of `api-2.1.md` (finding 13).

Smaller notes left out:

1. `narduk-shell` Install lists peers `nuxt`, `vue`, and `@nuxt/ui` and omits `vue-router` `^5.3.1` (`package.json:84`). The same README explains that peer at line 1605. No install was run, so there is no failed-install case.
2. The shell Status block still opens with "Tokens, wiring and first components." Later sections of the same README document the newer components.
3. `AGENTS.md` quality bar says CI runs `uv sync --frozen` and also says "enforced: none yet." `logging-languages.yml` runs `uv run --locked` in `packages/modules/narduk-logging/python`, where `uv.lock` does exist.
4. The root README Fix Policy and `AGENTS.md` Library-first fixes say the same rule. They do not disagree.
5. `docs/operations/template-decoupling/README.md` frontmatter says `last_verified: 2026-07-15` while the evidence index cites later BSF PRs. Findings 2 and 9 cover the false instructions.
