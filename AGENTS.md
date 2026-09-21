# Narduk Libs Agent Guide

This repo owns the reusable published packages and focused one-shot tooling used
by Narduk Cloudflare/Nuxt apps. It is not a fleet template and must never create
a continuing sync, reconcile, drift, or control-plane relationship with apps.

## Scope

- Shared Nuxt modules, runtime helpers, test helpers, focused app-local tooling,
  and the deterministic one-shot app generator live in four families under
  `packages/`: `modules/` (Nuxt runtime modules and layers), `tooling/` (build,
  test and generator tooling), `design/` (the coded NE design system) and
  `contracts/` (shared contracts). The layout is company-hq `D-WEBFOUND-2` Q2
  (a); `pnpm-workspace.yaml` is the single source of truth for where a package
  lives, so scripts resolve package directories from it rather than assuming
  `packages/<name>`.
- The app generator may create a new repository layout once. It must not manage
  that repository afterward and must not call Command, Cloudflare, GitHub, or
  Doppler directly.
- Fleet sync, starter reconciliation, drift enforcement, registry mutation, and
  central deployment orchestration stay out of this repo.
- Keep package changes source-compatible for existing fleet apps unless the user
  explicitly approves a breaking release.

## Workflow

- Preserve unrelated local changes.
- Make narrow package changes and validate the touched packages before publish.
- Do not commit token-bearing files such as `.npmrc.auth`.
- Publish package versions from this repo only after build/pack validation.

## Library-first fixes

- When a fleet app exposes a bug in shared auth, runtime, Cloudflare, Nuxt, SEO,
  analytics, upload, D1, KV, R2, or deployment behavior, default to fixing it in
  the owning package here.
- App-local papering over is a temporary exception, not the normal path. It
  needs a clear written justification, a narrow blast radius, and a follow-up
  plan to remove it after the library fix ships.
- Do not let one app quietly fork shared behavior unless the app has a genuine
  product-specific requirement that does not belong in the reusable package.

## Issue labels

Label every issue at creation time with one type, one priority and one area,
using only labels that already exist (estate standard:
`narduk-enterprises/agent-infrastructure` `docs/ISSUE-LABEL-CONVENTIONS.md`).
Check the live set with `gh label list --repo narduk-enterprises/narduk-libs`.

- Type: `bug`, `enhancement`, `documentation`, `question`, `tracker` (umbrella
  issues).
- Priority: `P0-critical`, `P1-high`, `P2-medium`, `P3-low`.
- Area: `area:auth`, `area:core`, `area:devices`, `area:eslint-config`,
  `area:foundation`, `area:journeys`, `area:logging`, `area:mapkit`,
  `area:postgres`, `area:release`, `area:seo`, `area:shell`, `area:testkit`.
  `area:mapkit`, `area:testkit`, `area:logging` and `area:seo` were added on
  2026-09-18 at Logan's direction.

## Backlog clear-out freeze

Milestone `backlog-clearout` holds the 190 issues that were open at 2026-09-20
22:56Z, frozen as the campaign's scope
([plan](docs/plans/backlog-clearout-plan.md)). Filing stays unrestricted, and
this changes nothing about how you label a new issue.

A new issue does **not** go in that milestone by itself — a filing agent leaves
the milestone unset. Search before filing: three separate issues (#544, #561,
#631) turned out to be one toolchain defect.

What happens to something you find mid-item (Logan, 2026-09-20: _"as new issues
are found along the way they should be folded into the work if they are easy or
a new issue filed if they are larger, and we should recalibrate the waves to
include the new issues as we work the backlog"_):

- **Easy, and in the area you are already changing** — fix it in the same PR and
  say so in the body. Do not file an issue for something you just fixed.
- **Larger, or outside your item's scope** — file it, labeled, milestone unset,
  and keep going. A P0, a security defect or a release blocker also gets a line
  to the campaign orchestrator immediately.
- **The orchestrator recalibrates at every wave boundary**: it reviews the
  issues filed since the freeze, admits the ones that belong into the milestone,
  and rewrites the lane queues. Nothing gets admitted silently — admission is
  said on the issue.

Two numbers are tracked separately, so "cleared" stays a definable state: the
baseline 190 drained, and the count admitted since the freeze.

<!-- enforcement: none yet -->

## Validation

- `pnpm run preflight` — the whole pull-request fast path in one command, and
  the quickest way to find out what CI will say. It plans the diff against
  `origin/main` (fetching that ref first — whatever `--base` names, so long as
  it names a remote — because a stale base is what makes `release-plan:check`
  report packages you never touched), prints the affected packages and which
  consumer proof applies, runs the `contracts` checks in that job's own order
  through `pnpm audit --audit-level high`, then runs the affected packages'
  gates through the same `runPackageGates` CI uses, and finishes by building the
  packed scope and proving it artifacts-only — the same build-then-pack pairing,
  with the same scope on both, that the `packed-consumer-smoke` job runs. It
  never writes: the package gates run with `CI=true` so `narduk-lint` cannot
  rewrite `lint-budget.json` (#623), and the tracked tree is compared before and
  after every phase, so any other writer fails the run and is named. Flags:
  `--base <ref>`, `--no-fetch`, `--no-consumer`. A diff that touches a global
  trigger such as the root `package.json` or the lockfile selects every package,
  and the command says so before spending the time.
- `pnpm install`
- `pnpm run quality`
- `pnpm run surface:check` (inside `quality:artifacts`): every component
  `narduk-shell` registers, and every `./format` export, has a README section,
  tests and a design card shipped beside it. Failures print the exact fix; see
  `packages/design/narduk-shell/README.md` § "Component surface check".
- For a touched package, also run its focused typecheck/unit tests and
  `pnpm pack --dry-run` before publication.
- New package releases must be installable from their packed artifact by a
  consumer fixture outside the workspace.
- A Changeset that moves the version of any package the generator pins
  (`PACKAGE_VERSIONS` in `packages/tooling/create-narduk-app/src/manifest.ts`),
  directly or through an internal-dependency bump, must also list
  `'@narduk-enterprises/create-narduk-app': patch`.
  `pnpm run release-plan:check` enforces it in `contracts`, and on a pull
  request that failure cancels every package job, so the whole run reads red
  (#198). Run it locally with `main` at `origin/main` first; a stale local
  `main` reports unrelated packages (#492).
- Release mechanics, the `chore: release packages` PR's run approvals and the
  post-merge publication proof are in `docs/package-releases.md`.
