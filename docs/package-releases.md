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

The Changesets run that only opens a release PR skips the registry proof.
Superseded preparation commits leave the current version PR alone. An already
published version commit still repeats registry verification on retry, so a
previous verification failure cannot turn green merely because publication is
now a no-op.

Publishing uses this repository's job-scoped `GITHUB_TOKEN` with
`packages: write` inside the main-only `npm-release` environment. GitHub
Packages must grant this repository Actions access to every existing package,
including packages not automatically linked to this repository. Before writing
registry auth, the job checks that its token can read metadata for every current
publication target; a missing or foreign package fails closed. Changesets gets a
mode-0600 temporary home for its git push credential, created only after the
dependency install and removed on exit. The release's exact version registry
proof uses the same temporary token config.

## When a Changeset is required

`pnpm run release-plan:check` decides this in the `contracts` gate. It compares
each changed workspace package against the Changesets base branch and applies
two plain rules.

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

## Failed or partial publish

- Do not change, delete, or reuse a version that may have reached the registry.
- Fix authentication, registry availability, or the failing package metadata,
  then rerun the failed release job. Changesets leaves already-published exact
  versions intact and publishes the remaining planned versions.
- Confirm the current manifests with `pnpm run release:verify-published` using a
  temporary authenticated npm config. Do not place tokens in the repository.
- If package manifests had to change, create a new Changeset and publish higher
  versions instead of attempting to replace an artifact.

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
