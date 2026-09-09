# CI commands and evidence

`pnpm ci:plan` shows packages selected from the diff against `origin/main`,
including staged, unstaged and untracked local files. Pass
`--base REF --head REF` for another comparison or `--all` for the full
workspace. Selection uses `pnpm-workspace.yaml` and transitive dependents;
shared tooling/configuration changes select every package. The plan prints
reasons and all five package gates.

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
current main SHA and latest attempt.

Use focused validation after meaningful edits, then the relevant integration
proof at the final candidate. A result is reusable locally only while its
source, command and relevant environment are unchanged. Report which gates
actually ran. Compare admission, setup/install, cache transport and useful work
separately when changing CI; summed job-minutes are pool demand, not end-to-end
latency or CPU utilization.
