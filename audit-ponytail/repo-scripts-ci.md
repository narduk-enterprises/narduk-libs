# Ponytail audit: repo scripts and CI

What this repo does: This repo publishes the shared `@narduk-enterprises` npm packages that Nuxt apps on Cloudflare Workers install. The root scripts and the GitHub workflows choose which packages a pull request checks, pack a consumer proof, and publish only a commit that CI has already proved. I assumed about 30 workspace packages, one hosted job per affected package, one release concurrency group, and a release merge that can start publishing from the tree rule before the push CI run has finished.

I read the root manifests, the nine workflow files, and the release, preflight, and selection scripts those workflows call. I read the tests that lock the wait and proof decisions I cite.

## Must fix

### 1. release-wait says a missing version is mirrored (scripts/release-wait.mjs:88-92)

**What this is.** `pnpm run release:wait <merge-sha>` is the command the release doc tells an operator to leave running until that merge's versions are on `npm.nard.uk`.

**Problem.** `mirrorMissing` keeps waiting only when `versionState` returns `missing`. `versionState` returns `superseded` when the exact version is absent and `dist-tags.latest` is already newer (`scripts/prove-release-publication.mjs:91-96`). That version leaves the wait list. The command then prints `is mirrored:` and names the old version (`scripts/release-wait.mjs:444-448`). Concrete case: the publish tag is `@narduk-enterprises/narduk-core@2.2.2`, and the mirror packument has `2.2.3` as `latest` and no `2.2.2`. The command exits 0 and says `2.2.2` is mirrored. `scripts/release-wait.test.mjs:113-127` expects that empty list. The publication proof keeps polling until the state is `present` (`scripts/prove-release-publication.mjs:237`).

**Fix.** Treat every state other than `present` as still outstanding. When the state is `superseded`, exit non-zero and name the version and `latest`.

**If we skip it.** An operator can stop and tell apps to install a version the mirror does not serve.

## Should fix

### 2. Logging Linux CI never runs SwiftLint (.github/workflows/logging-languages.yml:37-40)

**What this is.** The Linux Swift job is the CI run for `packages/modules/narduk-logging/swift`. Root `.swiftlint.yml` includes only that tree and turns on `force_try` and `force_unwrapping`.

**Problem.** The job installs Swift and runs `swift-quality.py`. It does not install SwiftLint. That script runs SwiftLint only when the binary is already on `PATH` (`packages/modules/narduk-logging/scripts/swift-quality.py:31-32`, outside this lane). `ubuntu-latest` does not ship it, so the step exits 0. Concrete case: a pull request adds `try!` under `packages/modules/narduk-logging/swift/`. The logging job stays green. The macOS job installs SwiftLint and lints `packages/modules/narduk-auth/swift` with that directory's own config, so it does not apply the root file.

**Fix.** Install the same pinned SwiftLint release the macOS job uses, the Linux build, and put it on `PATH` before `swift-quality.py`.

**If we skip it.** The force-unwrap and force-try rules in the root SwiftLint config never fail a pull request. Editing `.swiftlint.yml` still schedules the job (`scripts/logging-ci-plan.mjs:11`) and still passes.

### 3. The logging language job never runs the Go checks (.github/workflows/logging-languages.yml:9-40)

**What this is.** `scripts/logging-ci-plan.mjs:9-13` turns this workflow on for any path under `packages/modules/narduk-logging/`. The workflow then runs Python `quality.py` and the Linux Swift script.

**Problem.** Nothing in the workflow calls `packages/modules/narduk-logging/scripts/go-quality.py`. That script runs `gofmt`, `go vet`, `go test`, and a small consumer. Concrete case: `TestHandlerRedactsSensitiveAttrs` in `packages/modules/narduk-logging/go/handler_test.go` fails. A pull request that only edits that test sets `logging-languages=true`, the Python and Swift jobs pass, and the pull request is green.

**Fix.** Add a job that runs `go-quality.py` when the logging plan is on.

**If we skip it.** A broken Go redaction or formatting change merges while CI still spends the Swift job on that pull request.

### 4. The publication proof gives up while an early Release run can still publish (scripts/prove-release-publication.mjs:161-170)

**What this is.** After a release merge, `release-proof.yml` polls GitHub Packages. `githubDecision` fails immediately when the push CI run for that commit has finished with any conclusion other than `success`.

**Problem.** The comment above that branch says Release publishes only a commit whose push CI is green. The early path does not wait for that. On CI `requested`, a merge whose message starts with `chore: release packages` can pass the tree rule and start `changeset publish` before push CI finishes (`.github/workflows/release.yml:52-55` and `96-98`). `proveGithubPackages` does not read whether a Release run is still active until the 20-minute grace has elapsed (`scripts/prove-release-publication.mjs:198-208`), and the red-CI return happens before that read. Concrete case: the early Release run is still in `pnpm install` or `changeset publish`, and push CI has already finished as `failure` or `cancelled`. The proof errors with "Release cannot publish it". `mirror-settle` runs only when `served-count` is not `0` (`.github/workflows/release-proof.yml:96-98`), so the mirror half never starts. The Release run can still publish. `scripts/prove-release-publication.test.mjs` locks the red-CI return and does not pair it with an in-progress Release run.

**Fix.** If a Release run for this SHA is `queued` or `in_progress`, keep waiting. Treat a finished red push CI run as final only when no Release run for that SHA is still active.

**If we skip it.** A flaky or cancelled push CI run marks the release proof red and skips the mirror check for versions that do get published.

### 5. Recheck treats a skip-group queued run as the run that will publish (scripts/recheck-release-main.mjs:42-45)

**What this is.** After a Release run whose commit is no longer `main`, `recheckDecision` either leaves the next step to a queued Release run, waits for the tip's CI, or dispatches `release.yml` for a green tip.

**Problem.** Any other `release.yml` run in `queued`, `waiting`, `pending`, or `requested` produces `queued`, and this run dispatches nothing. The list is every recent `release.yml` run (`scripts/recheck-release-main.mjs:99-100`). It does not look at the concurrency group. A normal main push starts a Release run in `narduk-libs-release-skipped-<run_id>` (`.github/workflows/release.yml:35-38`). That run's jobs are skipped by the `if` on `verify-ci`. While it is still `queued`, recheck returns `queued` and the notice says that run will take main forward. Concrete case: the tip's push CI is green, the Release run that should have followed it is gone (the case this script exists for), and a skip-group run for some other CI `requested` event is still `queued`. Recheck does not dispatch. The skip run then finishes with every job skipped. Nothing prepares the release PR for the tip.

**Fix.** Count a waiting run only when its concurrency group is `narduk-libs-release`. Ignore a `requested` run whose head commit message does not start with `chore: release packages`.

**If we skip it.** The lost-release recovery stays blind for the whole time any skip-group run is queued, and it does not retry.

### 6. release-wait remembers a bad log read (scripts/release-wait.mjs:107-118)

**What this is.** The waiter finds the Release run by reading the `verify-ci` log for `Verified full CI for <sha>`. The comment says a null result is cached only for a finished job that did not succeed.

**Problem.** On a successful `verify-ci` job, a log that does not contain the SHA is also cached, including an empty string. `readJobLog` uses `gh` with `reject: false`, and any non-zero status becomes `''` (`scripts/release-wait.mjs:223-228`). Concrete case: the Release run succeeded and the log line is present, and the first `gh run view --job <id> --log` hits a 502 or a rate limit. `resolveVerifiedSha` stores null for that run id. Later polls never read the log again. The command sits until the 90-minute timeout. `scripts/release-wait.test.mjs:251-262` locks that cache with a 404 body, which is the same write as a transient `gh` failure.

**Fix.** On a successful `verify-ci` job, cache a value only when the SHA parses. Return null without caching when the log does not contain one.

**If we skip it.** One log-fetch blip hides a finished release for the rest of the wait.

### 7. verify-published turns every registry error into "not propagated yet" (scripts/verify-published-packages.mjs:44-51)

**What this is.** After publish, this script polls `pnpm view <name>@<version>` on GitHub Packages, then does a frozen install of every publishable package outside the workspace.

**Problem.** Any non-zero `pnpm view` returns `undefined`. The loop retries 12 times, 5 seconds apart, then throws `Exact package versions did not resolve` with no status and no registry error code. There is no test file. Concrete case: `pnpm view` exits 1 with `E401` or `E500`. The step waits about a minute and reports a propagation miss. `publish-verified-packages.mjs` `registryField` fails a non-404 immediately (`scripts/publish-verified-packages.mjs:114-116`). This step runs after a publish that may already have succeeded, so the red job reads as "the registry has not caught up."

**Fix.** If the status is non-zero and the body is not `E404`, throw with the status and the registry error code. Keep the retry for `E404` and empty output.

**If we skip it.** An auth failure or a 5xx costs a minute and hides the error the operator needs.

### 8. One mirror blip kills release-wait (scripts/release-wait.mjs:415-421)

**What this is.** The wait loop polls push CI, the Release run, tags, and `npm.nard.uk` for up to 90 minutes.

**Problem.** `readMirror` throws on any status other than 200 or 404. `waitForRelease` does not catch it, so the process exits. Tag reads are the other way: a non-zero `gh api` becomes "tag missing" and the loop continues (`scripts/release-wait.mjs:397-403`). Concrete case: the tags are already present, and `npm.nard.uk` returns 502 once. The 90-minute command dies. The publication proof fails closed on a non-404 so it will not dispatch from a bad read. This command's "missing" means "try again."

**Fix.** In the loop, log a non-OK mirror response and continue until the deadline.

**If we skip it.** A single blip looks like a hard failure of the release, and the operator has to start the 90-minute wait over.

### 9. release-wait names the wrong blocker when the parent commit is missing (scripts/release-wait.mjs:189-193)

**What this is.** Targets come from the merge commit and its first parent (`scripts/release-wait.mjs:121-127`). Null means that comparison was not readable.

**Problem.** The loop logs `waiting for changeset-release/main to refresh`. Concrete case: `git fetch --depth=2` did not materialize `mergeSha^1`. The release branch can already be current. The command repeats that sentence until it times out.

**Fix.** When `readTargets()` returns null, log that the merge commit or its parent was not readable.

**If we skip it.** The operator spends the wait looking at the release branch while the clone is missing the parent.

### 10. The pull-request smoke gate drops a renamed script (.github/workflows/ci.yml:132)

**What this is.** On a pull request, a shell step can force `packed-consumer` and `generated-consumer` to `false` unless a path matches its regex. The planner uses `git diff --name-only --no-renames` because a rename otherwise hides the old path (`scripts/compute-affected-packages.mjs:385-392`, the #915 fix).

**Problem.** The smoke gate runs `git diff --name-only` with rename detection left on, so a pure rename is listed only at the new path. Concrete case: rename `scripts/release-packages.mjs` to `scripts/pack-release.mjs` and change no other file. The planner sees both paths, `scripts/` is a global trigger, and `packedConsumer` is true. The gate's list shows only `scripts/pack-release.mjs`, which misses the `release-packages` prefix, so `run=false`. `verify` then expects the smoke to be skipped. The pull request is green. The next push to `main` still uses the planner, calls the old path, and fails.

**Fix.** Pass `--no-renames` on that `git diff`, the same flag `changedFilesBetween` uses.

**If we skip it.** A rename of a smoke script can merge without the smoke, and `main` goes red on the next push.

### 11. Preflight says to discard dist that the build says to commit (scripts/preflight.mjs:239-249)

**What this is.** After each phase, `newlyDirtyPaths` fails the run when the tracked tree changed. The message says to discard those paths. `narduk-mapkit` and `narduk-realtime` commit `dist/`. Their `build` script runs `tsc` and then a dist-clean check. `nonWritingExecute` only sets `CI=true`. It does not stop `tsc` from writing.

**Problem.** Concrete case: edit `packages/modules/narduk-mapkit` source so `tsc` rewrites tracked `dist/`, then run `pnpm run preflight`. The package `build` gate fails. The dist-clean script (outside this lane, `packages/modules/narduk-mapkit/script/check_dist_clean.mjs:12-16`) says to commit the `dist/` changes. The preflight guard then lists those paths and says to discard them. Discarding restores the stale tree that CI's dist check rejects.

**Fix.** For dirty paths under those two committed `dist/` trees, say to commit them. Do not add a second failure on top of the build gate for those paths.

**If we skip it.** The local gate the release doc points at tells the author to delete the files CI requires.

### 12. The version-pin guard does not read `test/` (scripts/package-version-assertions.test.mjs:84-85)

**What this is.** This contracts test fails when a package test pins `manifest.version` to an exact `x.y.z` or to a regex with a hardcoded leading digit. That shape broke the release CI in #291 and #297. The comment limits the walk to a directory named `tests`.

**Problem.** The walker only opens `join(directory, 'tests')`. `@narduk-enterprises/narduk-shell`, the package from #291, keeps `package-shape.test.ts` in `test/`. `narduk-mapkit-nuxt` uses `test/` too. Concrete case: put `expect(manifest.version).toBe('1.2.3')` in `packages/design/narduk-shell/test/package-shape.test.ts`. This test stays green. The next release bump fails inside the package suite, which is the #291 outage.

**Fix.** Walk both `test` and `tests`.

**If we skip it.** The guard written for the shell incident does not see the directory that package uses now.

### 13. The Swift installer crashes in the session the setup script names (scripts/install-swift-linux.py:96-97)

**What this is.** `scripts/claude-cloud-env-setup.sh:28-30` and `:149-150` tell a cloud session to run `python3 scripts/install-swift-linux.py` when it needs the logging Swift gate. CI runs that same script after `actions/setup-python`.

**Problem.** `main()` requires `RUNNER_TEMP` and appends to `GITHUB_PATH` (`scripts/install-swift-linux.py:122`). Those variables exist on Actions. A cloud session does not set them, so the script raises `KeyError` before any download. Concrete case: follow the setup script's own line and run the installer on the cloud VM. It exits before Swift is installed.

**Fix.** When those variables are absent, install under a local prefix and print the `PATH` line.

**If we skip it.** The setup note points at a command that cannot succeed in that environment.

### 14. The cloud setup installs Node with no checksum (scripts/claude-cloud-env-setup.sh:69-75)

**What this is.** On a cloud VM the script downloads `node-v24.21.0-linux-x64.tar.xz` from `nodejs.org` and extracts it into `/opt/node24` as root. That directory is then placed on `PATH` for later shells.

**Problem.** The download checks TLS and the HTTP status. It does not check a SHA-256. The Swift installer in this repo verifies a signature, and the macOS SwiftLint step checks a pinned digest (`.github/workflows/auth-kit-swift.yml:49-51`). Concrete case: the bytes at that version URL are not the Node 24.21.0 release this repo pins. The script extracts them and later `pnpm` runs under that binary.

**Fix.** Verify the tarball against the published `SHASUMS256.txt` for `v24.21.0` before `tar`.

**If we skip it.** A substituted tarball becomes the Node that the cloud session uses for install and tests.

### 15. Every scripts change schedules the Swift toolchain (scripts/logging-ci-plan.mjs:9-14)

**What this is.** The logging language jobs run when the changed paths match this predicate. AuthKit's plan is limited to its Swift tree, the root manifest, and its own workflow files (`scripts/auth-kit-ci-plan.mjs:11-16`).

**Problem.** The logging predicate matches every path under `scripts/` and every path under `.github/workflows/`. Concrete case: a pull request edits only `scripts/prettier-single-version.test.mjs`. `logging-languages=true`. CI downloads the Swift toolchain and runs the Linux Swift job (timeout 30 minutes) and the Python job. Neither job reads that test.

**Fix.** Keep the logging tree, `Package.swift`, `Package.resolved`, `.swiftlint.yml`, `.swift-format`, `scripts/install-swift-linux.py`, `scripts/logging-ci-plan.mjs`, and `ci.yml` / `logging-languages.yml`.

**If we skip it.** Script-only and workflow-only pull requests keep paying for a Swift install that their diff does not exercise.

## Nice to have

### 16. The control-byte test skips Go, Swift, Python, and shell (scripts/source-text-bytes.test.mjs:36-51)

**What this is.** The test named "no tracked source file contains a raw control byte" walks the repo and fails on a byte below space, other than tab, newline, and carriage return. The #395 incident was a NUL in a TypeScript file that Git then hid from review.

**Problem.** The walker allows `.ts`, `.js`, `.vue`, `.css`, `.json`, `.md`, and `.yml` only. Concrete case: a NUL in `packages/modules/narduk-logging/go/handler.go`, a `.swift` file, or `scripts/install-swift-linux.py` is never read. The test stays green.

**Fix.** Add `.py`, `.go`, `.swift`, and `.sh`.

**If we skip it.** The same hidden-diff failure can land in the languages this gate does not open.

### 17. Local ci:plan packs every publishable package (scripts/ci-packages.mjs:167-183)

**What this is.** `pnpm ci:plan` and `pnpm ci:affected` call `localPlan`, which calls `computeAffectedSet` with the default scope mode `full`. Pull-request CI and `preflight` pass `scoped`.

**Problem.** Concrete case: a one-package source change in `narduk-mapkit`. CI's `resolveConsumerScope` packs that package's publishable dependency closure. `pnpm ci:plan` reports every publishable package, and `pnpm ci:affected` builds and smokes that full set.

**Fix.** Pass `consumerScopeMode: options.all ? 'full' : 'scoped'` from `localPlan`.

**If we skip it.** The local plan overstates the pull-request pack, and `ci:affected` does the full smoke on a one-package diff.

I left out 2 smaller items. The passkey warmup treats any HTTP response as ready (`scripts/consumer-smoke-passkey-probe.mjs:104-110`); I did not show that `wrangler dev` returns 500 on `/` while still booting. `red-main.yml` listens only to the CI workflow; the reusable listener is outside this repo, so I did not prove how it treats a skipped Release run.

Checked and left as a decision: the pull-request smoke allowlist at `.github/workflows/ci.yml:109-137`. It is a written cost rule. A push to `main` still uses the planner's answer.

Elsewhere, outside this lane's file list: `.prettierignore:118` is the pattern `design/`. Gitignore rules match a directory of that name in any folder, so the pattern also ignores `packages/design/**`. Root `pnpm run format:check`, which is the contracts format step, never sees those sources. I did not run Prettier.

Verdict: The release job still refuses to publish until CI has proved the commit, and I did not find a path that publishes a version the plan rejected. Fix `release-wait` before you trust it as the mirror proof. The other items are gates that stay green while the check they exist for did not run.

Not checked: the reusable workflows `node-library.yml` and `red-main-listener.yml` in `narduk-enterprises/workflows` (only this repo's `with:` and `permissions:`), package source under `packages/` beyond the CI entry scripts cited above, the body of `scripts/release-packages.mjs`, `scripts/check-component-surface.mjs`, `scripts/generate-capability-catalog.mjs`, `scripts/synthesize-manifest-drift.mjs`, and `scripts/approve-release-pr-ci.mjs`, and `tools/package-quality.mjs` line by line. There is no root `Config/` directory. I did not run installs, builds, or the workflows.
