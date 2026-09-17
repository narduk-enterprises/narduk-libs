# CI commands and evidence

`pnpm ci:plan` shows packages selected from the diff against `origin/main`,
including staged, unstaged and untracked local files. Pass
`--base REF --head REF` for another comparison or `--all` for the full
workspace. Selection uses `pnpm-workspace.yaml` and transitive dependents;
shared tooling/configuration changes select every package. The plan prints
reasons and all five package gates.

The plan also selects every affected package declaring `test:e2e`. Actions runs
those suites together on a hosted runner with one installation; this includes
both journeys and narduk-charts. Local commands use the same list.

`pnpm ci:affected` executes that plan. `pnpm ci:full` executes the complete
workspace. Both run repository contracts, strict package gates and applicable
browser/packed consumer checks. Browser tooling must be installed locally; CI
installs Chromium and its Linux libraries with Playwright.
`pnpm release:consumer-smoke` is the external packed-artifact proof and requires
built packages (run `pnpm build` first). `pnpm quality` remains the existing
broad formatting, lint, typecheck, build and unit-test command; it does not
include strict package checks, script tests or browser/consumer validation.

Actions runs package selection and repository contracts in parallel. Package
jobs, browser suites, the packed-consumer proof and logging language jobs start
as soon as selection succeeds, while contracts can still be running. The
always-running `verify` rejects failed, cancelled or missing contracts even if
every other job succeeds. Invalid contracts may spend runner time on work that
cannot pass the final gate; green runs avoid waiting for contracts before
package installs begin.

Actions starts one callable job per selected library. Each job installs its
dependencies and invokes `pnpm ci:batch` with a single-package
`PACKAGE_MATRIX_JSON` entry. The script runs lint → typecheck → build →
test:unit → check:package and prints that library's result and duration. The
same transitive dependency selection determines which jobs run. The planning
script still reports weighted batches (`--batch-count` accepts 1–8) for
inspection; those estimates never skip a gate or group hosted jobs.

The always-running `verify` job covers planner, package jobs, contracts and all
applicable integration jobs. Keep `ci / Required` while adopting `verify` in
repository protection. Empty docs/release-metadata selection is intentional;
planner failure, cancellation, missing expected output and failed mandatory work
must fail the aggregate. Release accepts only successful full CI for the exact
release SHA retained in main history and latest attempt. A version commit's CI
continues independently of later main pushes; the release checks out that exact
verified commit. Ordinary iterations still cancel superseded runs.

Every CI job runs on `ubuntu-latest`, including the shared package callable,
Python/Swift checks and browser/consumer gates. Forked PRs receive no registry
secret: every workspace package dependency in this repository's lockfile is
resolved locally, and `package-registry-auth: disabled` prevents the callable
from generating a registry credential. The release job runs on `ubuntu-latest`
after exact-SHA CI verification and requires the main-only `npm-release`
environment. The job-scoped `GITHUB_TOKEN` publishes with `packages: write`;
each existing package must grant this repository Actions access. Publication and
external registry proof still run only from verified main history.

The packed-consumer job restores a lockfile-keyed pnpm store seeded by a green
main run, and shares that store across its root and generated consumer installs.
Its first run can restore the existing browser job's root dependency store; the
next main run saves a dedicated store with generated-app dependencies. A new
lockfile starts cold; only main writes caches, so fork PRs cannot seed
dependencies for later runs. Its separate Turbo build cache still uses content
hashes to invalidate stale compiled output. The coordinated package build uses
two Turbo workers and keeps its `^build` dependency ordering; parent and nested
Node heaps and the charts-specific build remain capped at 2048 MiB. The
generated app phases continue sequentially.

The packed consumer always builds/packs packages, installs every packed package
outside the workspace, checks testkit exports/CLI, generates a fresh app, and
performs both its initial and frozen installs. On a main push only, the
expensive generated-app quality, migration, performance and Wrangler checks can
reuse the associated merged PR's successful proof. This extends draft PR #80's
lookup with an exact fingerprint of the tested Git tree, installed archive
contents, both resolved consumer lockfiles, generated sources, Node
binary/version, pnpm version, and the verified downloaded browser/native system
packages. Each missing or changed input runs the full proof. PR, manual and
local runs always execute all checks.

Archive comparison includes every member path, type, mode, owner, link and file
content. Only the packed `package/package.json` object-key order is
canonicalized: pnpm can reorder resolved workspace dependency keys between
identical packs. Archive transport headers/order are excluded. The corresponding
local tarball checksums in comparison copies of both lockfiles use that content
digest; all registry resolution bytes remain exact. Actual installs still use
the original fresh tarballs and lockfiles. Invalid or duplicate archive
members/manifests fail.

Proof lookup accepts only the latest successful CI run/attempt for that
same-repo PR head, its successful packed-consumer job, and one unexpired
seven-day artifact. It cannot reuse a receipt that itself reused a proof. Lookup
failures fall back to execution, with a twenty-second total lookup budget. The
current commit still gets its own required consumer job; its log identifies any
accepted prior run. Generated quality runs as individually timed format, lint,
unused-code, typecheck, build, unit and browser phases, derived from the actual
generated scripts. Lifecycle hooks and more complex shell commands stay intact.
Package validation and packing run two packages at a time; all compiled outputs
come from the preceding coordinated build. Phase timings appear in both logs and
the job summary. Per-package and generated-file digests identify proof
mismatches while retaining every content and dependency check. Only digests and
provenance are retained in the proof artifact.

Use focused validation after meaningful edits, then the relevant integration
proof at the final candidate. A result is reusable locally only while its
source, command and relevant environment are unchanged. Report which gates
actually ran. Compare admission, setup/install, cache transport and useful work
separately when changing CI; summed job-minutes are pool demand, not end-to-end
latency or CPU utilization.

The packed-consumer proof hashes the downloaded Chromium binary, installed
Playwright packages and manifest, OS release and native package inventory. A
different hosted image or browser binary causes a full generated-app proof.

## Prebuilt-Worker e2e

The shared `nuxt-cloudflare` callable sets `E2E_PREBUILT_ARTIFACT=1` and expects
the app to serve `.output/server/index.mjs` rather than `nuxt dev`. New
scaffolds wire that to `narduk-app e2e-serve <port>`
(`@narduk-enterprises/narduk-app-tools`). The command binds 127.0.0.1 only,
refuses to build when the artifact is missing, writes `[e2e-serve]` startup
notes to stderr, and filters only workerd's client-abort `Broken pipe` block
(buoys#124). See `packages/tooling/narduk-app-tools/docs/e2e-serve.md`.
