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

Actions runs package selection and repository contracts in parallel first.
Package batches, browser suites, the packed-consumer proof and logging language
jobs all require both preflight jobs to succeed before they reserve runners.
They fan out in parallel after preflight; a contracts failure skips the
expensive jobs and the always-running `verify` still fails. This trades one
contracts-job wait on green runs for avoiding full builds and browser proofs on
invalid input.

Actions installs once per batch and invokes `pnpm ci:batch` with the complete
lane in `PACKAGE_MATRIX_JSON`. This script validates the entire selection, runs
lint → typecheck → build → test:unit → check:package for each package, and
retains every failure while printing a per-package result and duration. At most
eight batches run by default (`--batch-count` accepts 1–8); the scheduling
estimates in `scripts/ci-package-durations.json` come from the cited Actions run
and affect ordering only. They never skip a gate. New packages receive a default
estimate.

The always-running `verify` job covers planner, package batches, contracts and
all applicable integration jobs. Keep `ci / Required` while adopting `verify` in
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
