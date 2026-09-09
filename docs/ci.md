# CI commands and evidence

`pnpm ci:plan` shows packages selected from the diff against `origin/main`,
including staged, unstaged and untracked local files. Pass
`--base REF --head REF` for another comparison or `--all` for the full
workspace. Selection uses `pnpm-workspace.yaml` and transitive dependents;
shared tooling/configuration changes select every package. The plan prints
reasons and all five package gates.

The plan also selects every affected package declaring `test:e2e`. Actions runs
those suites together on the isolated browser pool with one installation; this
includes both journeys and narduk-charts. Local commands use the same list.

`pnpm ci:affected` executes that plan. `pnpm ci:full` executes the complete
workspace. Both run repository contracts, strict package gates and applicable
browser/packed consumer checks. Browser tooling must be installed locally; CI
uses the dedicated immutable Playwright pool. `pnpm release:consumer-smoke` is
the external packed-artifact proof and requires built packages (run `pnpm build`
first). `pnpm quality` remains the existing broad formatting, lint, typecheck,
build and unit-test command; it does not include strict package checks, script
tests or browser/consumer validation.

Actions installs once per batch and invokes `pnpm ci:batch` with the complete
lane in `PACKAGE_MATRIX_JSON`. This script validates the entire selection, runs
lint → typecheck → build → test:unit → check:package for each package, and
retains every failure while printing a per-package result and duration. At most
four batches run; the scheduling estimates in
`scripts/ci-package-durations.json` come from the cited Actions run and affect
ordering only. They never skip a gate. New packages receive a default estimate.

The always-running `verify` job covers planner, package batches, contracts and
all applicable integration jobs. Keep `ci / Required` while adopting `verify` in
repository protection. Empty docs/release-metadata selection is intentional;
planner failure, cancellation, missing expected output and failed mandatory work
must fail the aggregate. Release accepts only successful full CI for the exact
release SHA retained in main history and latest attempt. A version commit's CI
continues independently of later main pushes; the release checks out that exact
verified commit. Ordinary iterations still cancel superseded runs.

The planner, `ci / Required`, `verify`, and release `verify-ci` jobs run on
GitHub's `ubuntu-slim` runners. They hold no repository secrets, perform no
package install, and gate the privileged self-hosted publication, fitting
company-hq's CI runner policy §2 exception 2. Their short work no longer queues
behind package builds. Package batches and repository contracts remain on the
manifest's `linux-ci` route; browser tests and packed consumers retain their
isolated browser route; publication retains `linux-deploy`. The callable's
`required-runner` input changes only its aggregate, preserving its check name
and failure rules.

The packed consumer always builds/packs packages, installs every packed package
outside the workspace, checks testkit exports/CLI, generates a fresh app, and
performs both its initial and frozen installs. On a main push only, the
expensive generated-app quality, migration, performance and Wrangler checks can
reuse the associated merged PR's successful proof. This extends draft PR #80's
lookup with an exact fingerprint of the tested Git tree, tarball bytes, both
resolved consumer lockfiles, generated sources, Node binary/version, pnpm
version, and the verified browser image/native system packages. Each missing or
changed input runs the full proof. PR, manual and local runs always execute all
checks.

Proof lookup accepts only the latest successful CI run/attempt for that
same-repo PR head, its successful packed-consumer job, and one unexpired
seven-day artifact. It cannot reuse a receipt that itself reused a proof. Lookup
failures fall back to execution, with a twenty-second total lookup budget. The
current commit still gets its own required consumer job; its log identifies any
accepted prior run. Phase timings are written to the job summary. Only digests
and provenance are retained in the proof artifact; registry authentication files
are excluded.

Use focused validation after meaningful edits, then the relevant integration
proof at the final candidate. A result is reusable locally only while its
source, command and relevant environment are unchanged. Report which gates
actually ran. Compare admission, setup/install, cache transport and useful work
separately when changing CI; summed job-minutes are pool demand, not end-to-end
latency or CPU utilization.
