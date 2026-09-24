# Package release and rollback runbook

`narduk-libs` publishes independent, immutable SemVer packages to GitHub
Packages. A release never republishes an existing version and never unpublishes
an artifact.

For the consumer-side sequence after publication, including exact-version lock
regeneration, app-owned configuration, migration adoption, exact-head CI, and
source production proof, use the
[`operations/template-decoupling/`](operations/template-decoupling/README.md)
runbook and evidence exemplar.

## Normal release

1. Add a Changeset for every publishable package whose public artifact changes.
   Two kinds of change do not need one; see
   [When a Changeset is required](#when-a-changeset-is-required).
2. Open or update the release PR by merging the package change to `main`. The CI
   workflow runs package gates, repository contracts and applicable browser and
   packed generated-app checks. The release workflow verifies successful full CI
   (`verify`) for the exact release SHA and latest run attempt in a read-only
   job before the release job receives write permissions. Manual dispatch must
   pass the same proof. The commit must remain in main's history; a later merge
   does not invalidate its completed tests. Version commits have their own CI
   concurrency group so later development cannot cancel them.
3. Let app CI validate the release PR from a fresh frozen install. The packed
   consumer gate must prove every runtime dependency between local packages was
   rewritten from `workspace:*` to the exact coordinated release version; this
   prevents stale core, auth, or platform versions from entering the graph.
4. Review and merge the release PR. Changesets publishes the exact checked-out
   version commit, which must contain no pending changesets. Registry preflight
   refuses unpublished versions that would move `latest` backwards. A commit
   with pending changesets may prepare a version PR only while it is current
   main.
5. For a publication commit, including retries, the workflow waits for registry
   propagation, resolves every publishable manifest at its exact version, and
   performs both an initial and frozen external consumer install. A release is
   not complete until this proof passes.
6. After the release PR merges, the **Release publication proof** workflow
   (`.github/workflows/release-proof.yml`) proves that every version the merge
   commit bumped is served by GitHub Packages and by `npm.nard.uk`, and
   re-dispatches whatever did not arrive. See
   [Release publication proof](#release-publication-proof).

The Changesets run that only opens a release PR skips the registry proof.
Superseded preparation commits leave the current version PR alone. An already
published version commit still repeats registry verification on retry, so a
previous verification failure cannot turn green merely because publication is
now a no-op.

Publishing uses this repository's job-scoped `GITHUB_TOKEN` with
`packages: write`, after `verify-ci` pins the run to a CI-verified commit on
main. The publishing job does not use the main-only `npm-release` environment:
that environment holds the estate App key, and GitHub gives environment secrets
to every job that uses the environment. Only install-free jobs use it
(`notify-mirror` in `release.yml`, `mirror-redispatch` in `release-proof.yml`),
so the key never shares a runner with dependency install scripts. GitHub
Packages must grant this repository Actions access to every existing package,
including packages not automatically linked to this repository. Before writing
registry auth, the job checks that its token can read metadata for every
publication target that has a release tag (`<name>@<version>`); a missing or
foreign package among those fails closed. A target with no release tag has never
been published and has no GitHub Packages metadata to read yet, so it is named
in the log and left to its first publish, which creates both the package and its
tag. Changesets gets a mode-0600 temporary home for its git push credential,
created only after the dependency install and removed on exit. The release's
exact version registry proof uses the same temporary token config.

## Packed consumer preparation

Contracts run alongside the selected package and integration jobs. On a
contracts failure in a same-repository pull request, a separate job cancels
queued and running work in that CI run without adding a dependency barrier to
successful runs. Only this checkout-free job gets `actions: write`; GitHub's
normal cancellation still lets the final `verify` report the failed gates.
Cancellation takes effect after GitHub schedules the handler and processes the
request. Fork and Dependabot runs have read-only tokens, so they retain the
failed `verify` gate but cannot cancel their sibling jobs. Pushes to `main` are
never cancelled this way: GitHub concludes a cancelled run as "cancelled", not
"failure", which hid a red `main` twice on 2026-09-17. A broken `main` runs to
completion and shows a failed run.

`node scripts/prepare-packed-consumer.mjs` builds every publishable workspace
package and its dependency closure with two concurrent Turbo tasks by default.
CI uses `--build-concurrency=4` on its public Ubuntu runner (4 CPUs, 16 GiB) and
passes `--install-browser` to `release:consumer-smoke`. Chromium and its Linux
libraries install alongside packing and consumer installation, so browser setup
stays off the critical path even with warm build caches. The smoke script waits
for setup and checks its result before validating the browser toolchain; an
earlier failure also waits for the installer before cleaning up. Private
applications such as the design preview keep their normal package CI gate, but
are not built solely to prepare tarballs they never publish.

The smoke script packs each library once and runs strict `publint` against that
same tarball before installing it outside the workspace. Its generated-app
typecheck, build, browser, migration, performance and deployment checks remain
intact. Nuxt phases stay sequential because they share generated files and local
runtime state. The pnpm store may fall back to an older main cache across
lockfile changes; frozen installs and artifact validation remain mandatory.

The disposable app disables the unused Fontshare catalog through Nuxt Fonts'
`fonts:providers` hook. The fixture's Inter/OG font assets still resolve through
the other providers and remain subject to the browser's missing-resource checks.
This removes unrelated Fontshare network retries without changing published
modules or generated production apps. The build must report that the fixture
hook activated.

### Consumer scope

The affected-package planner selects two levels of consumer proof. Both use the
same `release:consumer-smoke` command locally and in CI:

- **Packed artifacts** (`--artifacts-only`): pack and strictly lint every
  publishable package, install the coordinated tarballs outside the workspace,
  check versions and export resolution, execute testkit imports and its CLI,
  then execute the packed generator and validate its manifests and references.
  This mode never installs Chromium or the generated app, runs Nuxt/browser/D1
  integration, or produces a reusable generated-app proof.
- **Generated app** (the default): all artifact checks plus the generated app's
  initial/frozen installs, typecheck, build, browser tests, D1 migrations,
  performance budget, and deployment dry-run. Existing exact-input PR-to-main
  proof reuse remains available only for this level.

The app's inputs come from the generator's manifest factories and the shared
smoke fixture options in `scripts/consumer-smoke-fixture.mjs`. Selection
includes runtime, peer, optional, and build dependencies, plus the generator
itself; there is no package-name allowlist to maintain. The packed generator's
actual manifests are checked against that scope before the artifact-only path
can pass. For example, a charts or geogrid source change still gets artifact
validation, but does not build a generated Nuxt app that never installs that
package.

Shared repository inputs and unclassified paths select the full proof. Release
PRs/commits, manual workflow dispatch, and `ci:full` also select full
validation. Docs, changeset-only and package-test-only changes retain their
existing skips. A private preview-only change keeps its own package gates; a
private helper used by a publishable package still selects consumer validation.
The final `verify` check rejects missing or contradictory selection outputs.
Only full app runs upload `packed-consumer-proof`, so an artifact-only pass
cannot be reused as browser or D1 evidence.

## When a Changeset is required

`pnpm run release-plan:check` decides this in the `contracts` gate. It compares
each changed workspace package against the Changesets base branch and applies
two plain rules. The comparison ref defaults to the remote-tracking
`origin/<baseBranch>`, not the local branch, and the first output line names it
(#619): a stale local `main` makes every commit that landed upstream read as the
branch's own. `--base <ref>` overrides it, and
`pnpm run release-plan:check -- --base <ref>` works.

**A devDependency-only change never needs a Changeset.** If the only thing that
moved inside a package directory is `devDependencies`, or a `scripts` entry that
neither this repository's packing lifecycle nor a consumer's install runs, then
nothing about the published tarball changed and no release is owed. A Dependabot
bump such as `vitest` across every package manifest now passes untouched. It
used to fail: the check read its plan out of `changeset status`, which exits 1
whenever any package directory changed without a Changeset, regardless of what
changed (PR #323, run 35173069724).

**A runtime dependency bump is patch-released without a human commit.** If the
only thing that moved is a `dependencies` or `optionalDependencies` _range_ --
no dependency added or removed, no `workspace:` link touched -- the change
merges without a Changeset, and the release job writes one. Before the
Changesets action prepares a version, `pnpm run release:synthesize-drift`
compares every publishable package's dependency ranges against the manifest of
the version that is actually on the registry and writes a patch Changeset for
each package whose published manifest is now stale, plus a generator patch when
one of those packages is pinned by create-narduk-app. A Dependabot security bump
of a runtime dependency therefore reaches consumers without anyone pushing a
commit onto a Dependabot branch.

Synthesis can only ever open the `chore: release packages` PR, never publish:
the Changesets action publishes only from a commit with no pending Changesets,
so the release still passes full CI and a human merge. It writes nothing while
any publishable version is still waiting to publish, and it fails the release
job on any registry read it cannot resolve rather than silently withholding a
release.

Synthesis only runs when the release workflow does, and the release workflow
only runs on a push to `main` (or a manual dispatch). A `deferred` bump whose
release run never happened -- red CI on that push, or a queued run cancelled by
the `narduk-libs-release` concurrency group when a third run arrived -- leaves
the drift on `main` with nothing scheduled to release it, until the next
unrelated push. The escape hatch is to run the **Release packages** workflow by
hand:
`gh workflow run release.yml --repo narduk-enterprises/narduk-libs -f verified-sha=$(git rev-parse origin/main)`.
Passing current `main` is what makes the job synthesize; an older ancestor SHA
publishes but does not compare manifests.

Everything else still needs a Changeset, and the failure prints the exact
`.changeset/*.md` file to add: any file other than `package.json` under the
package directory, any `peerDependencies` change (that range is the package's
own compatibility contract and its SemVer impact is a human judgement), a
dependency added or removed, `exports`/`main`/`files`/`bin`/`version` and every
other manifest field, including one this repository has never seen -- the
dev-only list is an allowlist, so a new npm field cannot become exempt by
default.

The check is skipped on `changeset-release/*` branches, whose version commits
legitimately rewrite every manifest with the Changesets already consumed.

## Consuming a fix that is merged but not yet published

An app that needs a library fix sees a gap between the fix merging here and a
version containing it existing on the registry. It closes when the
`chore: release packages` PR (branch `changeset-release/main`) merges and
publishes (narduk-libs#589).

- **What triggers the release PR.** The Release workflow opens or updates it on
  every merge to `main` that carries a Changeset. Nothing batches it on a
  cadence: it sits open, collecting every pending Changeset, until someone
  merges it.
- **Who merges it.** If a campaign orchestrator is running in this repository,
  it owns release merges; ask it rather than merging. Otherwise the lane blocked
  on the fix may merge it through the same gate as any PR (`verify-pr-gate.py`
  GREEN on its current head, after
  [Approving `chore: release packages` PR runs](#approving-chore-release-packages-pr-runs)
  has landed required checks on that head — normally via `release-pr-ci`
  dispatch, with manual approve only if that job warns). The PR publishes every
  pending package, not only yours, so read its package list before merging, and
  treat the [Release publication proof](#release-publication-proof) as the end
  of the job, not the merge.
- **Pinning ahead of publication.** Do not push an app PR that pins a version
  which does not exist yet. Its install fails for a reason that is not the PR's
  fault, and the red check looks the same as a real failure. Keep the pin local,
  or open the app PR as a draft that says which version it waits for, and push
  the pin once `npm view <package>@<version>` resolves on `npm.nard.uk`.
- **Never work around it in the app.** Copying the fix into the app, patching
  `node_modules` or vendoring the source is exactly the fork this repository
  exists to prevent, and it is the hardest to find later. Wait for the release.
  If the wait itself is the blocker, say so to whoever owns release merges.

## Failed or partial publish

- Do not change, delete, or reuse a version that may have reached the registry.
- Fix authentication, registry availability, or the failing package metadata,
  then rerun the failed release job. Changesets leaves already-published exact
  versions intact and publishes the remaining planned versions.
- Confirm the current manifests with `pnpm run release:verify-published` using a
  temporary authenticated npm config. Do not place tokens in the repository.
- If package manifests had to change, create a new Changeset and publish higher
  versions instead of attempting to replace an artifact.

### Release publication proof

Every push to `main` that changes a package manifest starts the **Release
publication proof** workflow. It lists the publishable versions that exact
commit bumped (a commit that bumps none finishes in seconds), then:

1. polls GitHub Packages with the job token for up to 75 minutes. After 20
   minutes, if push CI for the commit succeeded and no Release run is queued,
   waiting or running, it re-dispatches `release.yml` once with `verified-sha`
   set to the commit. It never dispatches into a busy `narduk-libs-release`
   group, because a new queued run replaces the pending one there. It fails at
   once, naming the CI run, when push CI for the commit concluded red. A missing
   version whose package already has a newer `latest` is _superseded_: it is
   reported as a warning and never republished (step 4 below). When a plain
   missing version sits beside a superseded one, the proof fails instead of
   dispatching, because `release.yml` refuses to move `latest` backwards;
2. polls `npm.nard.uk` anonymously for 15 minutes, re-dispatches the
   package-delivery "Sync to R2" once through the same downscoped
   `narduk-lane-automation` token as `notify-mirror`, and polls another 20
   minutes.

A red proof names each missing `name@version` in an `::error` annotation and in
the run summary; a green one is the publication evidence for that release. To
prove an older commit, run it by hand from `main`:
`gh workflow run release-proof.yml --repo narduk-enterprises/narduk-libs -f sha=<commit>`.

### A publish looks skipped or missing

Release runs only start from `main` CI completions (`branches: [main]` on the
`workflow_run` trigger), but a run can still read "skipped" or "cancelled"
without a publish being lost. Work through these steps in order and stop at the
first one that explains the gap:

0. Read the **Release publication proof** run for the release-PR merge commit.
   Green means both registries serve every bumped version; red names what is
   missing and why.
1. Find the Release run whose `verify-ci` `VERIFIED_SHA` is the release-PR merge
   commit. Read its "Prepare or publish" and "Verify immutable published package
   versions" steps; grep the step log for `Publishing "` rather than dumping
   full logs. A merge commit whose own `.changeset/` is empty publishes even
   when `main` has already moved on.
2. Treat that verify step as the GitHub Packages proof. The `gh` CLI token lacks
   `read:packages` and gets a 403 from the packages API.
3. Check the mirror:
   `curl -s "https://npm.nard.uk/@narduk-enterprises%2f<pkg>" | jq '.versions|has("<ver>")'`.
   `npm.nard.uk` is a mirror synced by `narduk-enterprises/package-delivery`
   "Sync to R2", whose cron can run hours apart. If GitHub Packages has the
   version and the mirror does not, dispatch the sync with
   `gh workflow run sync.yml --repo narduk-enterprises/package-delivery`. Do not
   republish.
4. Only if a version truly was not published, recover just the packages that no
   newer open or merged release PR will ship. If a newer release PR supersedes a
   package, ship that newer version instead and record the skipped run ID on
   that release PR.
5. Only then use the `verified-sha` escape hatch described in
   [When a Changeset is required](#when-a-changeset-is-required).

Worked example, 2026-09-18: release PR #477 merged as `f862443a`. Release run
35365638662 showed "skipped", but a PR-branch CI completion had triggered it.
The push CI for `f862443a` (35365631679) triggered Release run 35366115556,
which published narduk-core 2.2.2, narduk-app-tools 0.9.0 and create-narduk-app
0.9.4 at 16:05Z, after `main` had already moved to `7ae9278c` (#476). The next
run (35366209232) queued FIFO in the `narduk-libs-release` concurrency group
rather than being replaced. #476 carried a pending Changeset, so that run opened
release PR #479 (narduk-core 2.2.3). The manual `verified-sha` dispatch
35366749247 only re-verified versions that were already published. The versions
looked missing because the mirror had last synced at 15:48Z. A manual Sync to R2
run (35367304736, package-delivery#4) made them appear. Step 4 is Logan's rule
from that day: "There was a later release that has both fixes in it".

Prevention:

- Merge the release PR last, or wait for its publish run to finish before
  merging anything else to `main`. A later run still works; this only keeps the
  evidence unambiguous.
- `release.yml`'s `notify-mirror` job dispatches the mirror sync after every
  real publish (#481), and the publication proof re-dispatches it once more if
  the mirror still lags.

### Approving `chore: release packages` PR runs

The Release workflow's `release-pr-ci` job starts CI on `changeset-release/main`
after changesets/action reports a release PR number. It runs
`gh workflow run ci.yml --ref changeset-release/main` with the job-scoped
`GITHUB_TOKEN` (`actions: write` only; no secret, no environment, no checkout).
`workflow_dispatch` is GitHub's documented exception to `GITHUB_TOKEN` loop
prevention. A dispatch plans `--all`, and the required `ci / Required` and
`verify` checks land on the release PR's head commit.

That job is `continue-on-error`. If the dispatch fails, the run posts a warning
and the situation is the same as before the job existed: GitHub has already
created the PR's `pull_request` CI run and may be holding it as
`action_required` until someone approves it, which leaves `verify-pr-gate.py`
with no result on the current head. Approve only the held run for the release
PR's current head — do not approve a stale held run when `release-pr-ci` has
already started CI on that head:

```bash
head=$(gh pr view changeset-release/main --repo narduk-enterprises/narduk-libs \
  --json headRefOid --jq .headRefOid)
gh run list --repo narduk-enterprises/narduk-libs --branch changeset-release/main \
  --status action_required --json databaseId,headSha \
  --jq ".[] | select(.headSha == \"$head\") | .databaseId" |
  xargs -I{} gh api -X POST repos/narduk-enterprises/narduk-libs/actions/runs/{}/approve
```

Do not approve every held run on the branch. Each regenerated release PR leaves
its superseded heads' runs in `action_required`, and they share the PR's CI
concurrency group. On 2026-09-22 an unfiltered approve released 20 runs, 19 of
them stale. They took the group and cancelled the current head's run, which then
had to be re-run.

The designed path is the `release-pr-ci` dispatch, not authoring the release PR
with a GitHub App token. Widening that App's grant on this repository remains
Logan's decision and is tracked on #198.

## Bad release rollback

1. Stop app rollouts and identify the last known-good exact package versions.
2. Deprecate each bad exact version with a message naming its replacement. Do
   not unpublish it. If immediate containment is necessary, move the `latest`
   dist-tag back to the known-good exact version; apps must still use exact pins
   rather than relying on the tag.
3. Revert or correct the source, add a corrective Changeset, synchronize the
   generator's exact package pins, and publish a higher SemVer version.
4. For an affected app, revert its package-pin change, restore the prior frozen
   lockfile, pass app-owned CI, deploy through Workers Builds, and record the
   deployed SHA and route proof.
5. Database rollback is forward-only. Never reset a remote D1 database; ship a
   corrective migration after validating it against a production copy and its
   recovery snapshot.

Keep the failed workflow, package versions, deprecation message, corrective
release, consumer proof, and affected app deployment evidence in the migration
ledger.
